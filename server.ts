import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";
import fs from "fs";
import multer from "multer";
import sharp from "sharp";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { prisma } from "./src/db.js";
import type { PhotoOp, UserOp } from "@prisma/client";
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Schema vive em prisma/schema.prisma e é aplicado via `prisma migrate deploy`
// no entrypoint do container — ver docker/backend/entrypoint.sh.

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// --- S3 Setup ---
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_PREFIX = (process.env.S3_PREFIX || "zekateco-photos").replace(/\/$/, "");
const PRESIGNED_TTL = parseInt(process.env.S3_PRESIGNED_TTL || "3600");

let s3: S3Client | null = null;
if (S3_BUCKET) {
  s3 = new S3Client({
    region: process.env.AWS_REGION || process.env.S3_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY || "",
    },
  });
  console.log(`[S3] Configurado: bucket=${S3_BUCKET} prefix=${S3_PREFIX}`);
} else {
  console.log("[S3] Não configurado — usando armazenamento local");
}

function s3Key(pin: string) {
  return `${S3_PREFIX}/${pin}/face-photo.jpg`;
}

async function s3Upload(pin: string, buf: Buffer): Promise<void> {
  await s3!.send(new PutObjectCommand({
    Bucket: S3_BUCKET, Key: s3Key(pin), Body: buf, ContentType: "image/jpeg",
  }));
}

async function s3Presign(pin: string): Promise<string> {
  return getSignedUrl(s3!, new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key(pin) }), { expiresIn: PRESIGNED_TTL });
}

async function s3PresignKey(key: string): Promise<string> {
  return getSignedUrl(s3!, new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), { expiresIn: PRESIGNED_TTL });
}

async function s3RemovePhoto(pin: string): Promise<void> {
  await s3!.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key(pin) }));
}

async function s3Download(pin: string): Promise<Buffer | null> {
  try {
    const res = await s3!.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key(pin) }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as any) {
      chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

// Body parser apenas para endpoints do REP (text/plain ou application/push).
// Sem isso, multer não receberia multipart porque text() consome qualquer Content-Type.
app.use("/iclock", express.text({ type: "*/*", limit: "10mb" }));
app.use("/iclock", express.urlencoded({ extended: true }));

const PHOTOS_DIR = path.join(__dirname, "photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
app.use("/photos", express.static(PHOTOS_DIR, { etag: true, maxAge: 0 }));

wss.on("connection", (client) => {
  client.send(JSON.stringify({ type: "hello", boot_id: BOOT_ID }));
});

function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

type DeviceSession = { socket: import("net").Socket; lastSeen: number };
const deviceSessions = new Map<string, DeviceSession>();
const IDLE_KILL_MS = 60_000; // close idle socket after 60s; forces REP to reopen and re-register

const DEBUG_LOG = path.join(PHOTOS_DIR, "_debug.log");
function debugDump(sn: string, label: string, body: string) {
  try {
    const stat = fs.existsSync(DEBUG_LOG) ? fs.statSync(DEBUG_LOG) : null;
    if (stat && stat.size > 1_000_000) fs.truncateSync(DEBUG_LOG, 0);
    const preview = body.length > 400 ? body.slice(0, 400) + `... [+${body.length - 400} bytes]` : body;
    fs.appendFileSync(DEBUG_LOG, `\n--- ${new Date().toISOString()} SN=${sn} ${label} (${body.length} bytes) ---\n${preview}\n`);
  } catch {}
}

async function updateDeviceSeen(sn: string, ip: string, req?: express.Request) {
  const now = new Date();
  await prisma.device.upsert({
    where: { sn },
    create: { sn, alias: sn, last_seen: now, ip },
    update: { last_seen: now, ip },
  });
  broadcast({ type: "device_update", sn, last_seen: now.toISOString(), online: true });

  if (req?.socket) {
    const prev = deviceSessions.get(sn);
    if (prev && prev.socket !== req.socket && !prev.socket.destroyed) {
      prev.socket.destroy();
    }
    deviceSessions.set(sn, { socket: req.socket, lastSeen: Date.now() });
    const sock = req.socket as any;
    if (!sock._zkCloseAttached) {
      sock._zkCloseAttached = true;
      sock._zkSn = sn;
      req.socket.once("close", () => {
        const cur = deviceSessions.get(sock._zkSn);
        if (cur?.socket === req.socket) deviceSessions.delete(sock._zkSn);
      });
    } else {
      sock._zkSn = sn;
    }
  } else {
    const cur = deviceSessions.get(sn);
    if (cur) cur.lastSeen = Date.now();
  }
}

setInterval(async () => {
  const now = Date.now();
  for (const [sn, sess] of deviceSessions.entries()) {
    if (now - sess.lastSeen > IDLE_KILL_MS && !sess.socket.destroyed) {
      console.log(`[ZK] Idle reaper: closing socket for SN=${sn} (idle ${Math.round((now - sess.lastSeen) / 1000)}s)`);
      sess.socket.destroy();
      deviceSessions.delete(sn);
      broadcast({ type: "device_update", sn, online: false });
      try {
        // Comandos "sent" mas sem ack voltam para pending — serão reentregues ao reconectar.
        await prisma.command.updateMany({ where: { sn, status: 1 }, data: { status: 0 } });
        await prisma.userOp.updateMany({ where: { sn, status: "sent" }, data: { status: "pending", next_retry_at: null } });
        await prisma.photoOp.updateMany({ where: { sn, status: "sent" }, data: { status: "pending", next_retry_at: null } });
      } catch (e) {
        console.error("[ZK] idle reaper db error:", e);
      }
    }
  }
}, 15_000);

async function queueInitialCommands(sn: string) {
  const pending = await prisma.command.count({ where: { sn, status: 0 } });
  if (pending === 0) {
    await prisma.command.createMany({
      data: [
        { sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" },
        { sn, command: "SET OPTIONS FVInterval=7" },
      ],
    });
  }
}

// --- ZKTeco ADMS Endpoints ---

// Heartbeat
app.get("/iclock/ping", async (req, res) => {
  const { SN } = req.query;
  if (SN) {
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
    await updateDeviceSeen(SN as string, ip, req);
  }
  res.type("text/plain").send("OK");
});

// 0. Handshake / Registry
app.post("/iclock/registry", async (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] Registry from SN: ${SN}`);
  if (!SN) {
    return res.type("text/plain").send("RegistryCode=0\n");
  }

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
  const isNew = !(await prisma.device.findUnique({ where: { sn: SN as string } }));
  await updateDeviceSeen(SN as string, ip, req);

  if (isNew) {
    await queueInitialCommands(SN as string);
  }

  res.type("text/plain").send(`RegistryCode=REP_${SN}_abcd79\n`);
});

// 0b. Configuration Download (POST push)
app.post("/iclock/push", async (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] push from SN: ${SN}`);
  if (SN) {
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
    await updateDeviceSeen(SN as string, ip, req);
  }
  res.type("text/plain").send("OK");
});

// 1. Initialization and Polling (GET)
app.get("/iclock/cdata", async (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] cdata GET from SN: ${SN}`);

  if (SN) {
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
    const device = await prisma.device.findUnique({ where: { sn: SN as string } });
    await updateDeviceSeen(SN as string, ip, req);

    if (device) {
      return res.type("text/plain").send(
        `registry=ok\nRegistryCode=REG_${SN}_xyz789\nServerVersion=3.1.2\nPushProtVer=3.1.2\nRequestDelay=30\nTransTimes=00:00;14:00\nTransInterval=1\nRealtime=1\nBioPhotoFun=1\nBioDataFun=1\nEncryption=None`
      );
    }
  }

  res.type("text/plain").send("OK");
});

// Helper: insert log; returns the new row id, or null if it was a duplicate.
async function insertLogIgnoreDup(
  sn: string,
  pin: string,
  time: string | null,
  status: number,
  verifyType: number,
): Promise<number | null> {
  try {
    const t = time ? new Date(time) : null;
    const created = await prisma.log.create({
      data: { sn, pin, time: t, status, verify_type: verifyType },
    });
    return created.id;
  } catch (e: any) {
    // P2002 = unique constraint violation (idx_logs_unique on sn,pin,time)
    if (e?.code === "P2002") return null;
    throw e;
  }
}

// 2. Data Upload — real-time logs and tabledata (POST cdata)
app.post("/iclock/cdata", async (req, res) => {
  const { SN, table, tablename, Stamp } = req.query;
  const body = req.body as string;
  // Photo uploads use ?tablename=userpic|biophoto; ATTLOG/rtlog use ?table=...
  const t = (tablename as string) || (table as string);
  console.log(`[ZK] cdata POST from SN: ${SN}, table: ${t}, stamp: ${Stamp}`);
  if (SN) await updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  if (t === "rtlog" || t === "ATTLOG") {
    // rtlog format: "pin=1001 time=2024-04-25 10:30:45 ..."
    // ATTLOG format: "PIN\tTIME\tSTATUS\tVERIFY_TYPE"
    const lines = body.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;

      let pin: string, time: string, statusRaw: string, verifyTypeRaw: string;

      if (t === "rtlog") {
        const data: any = {};
        line.split(/\s(?=\w+=)/).forEach((part) => {
          const eq = part.indexOf("=");
          if (eq > -1) data[part.slice(0, eq)] = part.slice(eq + 1);
        });
        pin = data.pin; time = data.time; statusRaw = data.status || "0"; verifyTypeRaw = data.verify || "0";
      } else {
        [pin, time, statusRaw, verifyTypeRaw] = line.split("\t");
      }

      if (!pin || pin === "0") continue;
      const status = parseInt(statusRaw) || 0;
      const verifyType = parseInt(verifyTypeRaw) || 0;
      const id = await insertLogIgnoreDup(SN as string, pin, time, status, verifyType);
      if (id !== null) {
        broadcast({ type: "new_log", log: { id, sn: SN, pin, time, status, verifyType } });
      }
    }
  } else if (t === "OPERLOG") {
    debugDump(SN as string, "cdata-OPERLOG", body);
    console.log(`[ZK] OperLog from ${SN} (${body.length} bytes)`);
    const photoLines = body.split("\n").filter(l => /^(USERPIC|BIOPHOTO|userpic|biophoto)\b/.test(l.trim()));
    if (photoLines.length > 0) {
      const kind = /^biophoto|^BIOPHOTO/.test(photoLines[0].trim()) ? "biophoto" : "userpic";
      await parseAndSavePhotos(SN as string, photoLines.join("\n"), kind, `cdata-OPERLOG-${kind}`);
    }
  } else if (t === "USERINFO") {
    await parseAndSaveUsers(SN as string, body, "cdata-USERINFO");
  } else if (t === "userpic" || t === "biophoto") {
    debugDump(SN as string, `cdata-${t}`, body);
    await parseAndSavePhotos(SN as string, body, t, `cdata-${t}`);
    res.set("Connection", "close");
    res.type("text/plain").send("OK");
    req.socket?.once("finish", () => req.socket?.destroy());
    return;
  } else if (t === "tabledata" || /^(biophoto|userpic)\b/.test(body.trimStart())) {
    const kind = /^biophoto/i.test(body.trimStart()) ? "biophoto" : "userpic";
    debugDump(SN as string, `cdata-tabledata-${kind}`, body);
    await parseAndSavePhotos(SN as string, body, kind, `cdata-tabledata-${kind}`);
    res.set("Connection", "close");
    res.type("text/plain").send("OK");
    req.socket?.once("finish", () => req.socket?.destroy());
    return;
  } else {
    debugDump(SN as string, `cdata-unknown-${t}`, body);
    console.log(`[ZK] cdata POST unknown table: ${t}, body: ${body?.slice(0, 200)}`);
  }

  res.type("text/plain").send("OK");
});

// 2b. Query Data — device responds to DATA QUERY commands (photos, users, transactions)
app.post("/iclock/querydata", async (req, res) => {
  const { SN, tablename } = req.query;
  const body = req.body as string;
  const ct = req.headers["content-type"] || "";
  const cl = req.headers["content-length"] || "";
  console.log(`[ZK] querydata from SN: ${SN}, tablename: ${tablename}, url=${req.originalUrl}, CT=${ct}, CL=${cl}, bodyLen=${body?.length ?? 0}`);
  if (SN) await updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  debugDump(SN as string, `querydata-${tablename}`, `[CT=${ct}][CL=${cl}][URL=${req.originalUrl}]\n${body || "<empty>"}`);

  if (tablename === "user") {
    await parseAndSaveUsers(SN as string, body, "querydata-user");
  } else if (tablename === "userpic" || tablename === "biophoto") {
    await parseAndSavePhotos(SN as string, body, tablename as string, `querydata-${tablename}`);
  } else if (tablename === "transaction") {
    const lines = body.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const data: any = {};
      line.split(/\s(?=\w+=)/).forEach((part) => {
        const eq = part.indexOf("=");
        if (eq > -1) data[part.slice(0, eq)] = part.slice(eq + 1);
      });
      if (!data.pin || data.pin === "0") continue;
      const status = parseInt(data.status) || 0;
      const verifyType = parseInt(data.verify) || 0;
      const id = await insertLogIgnoreDup(SN as string, data.pin, data.time || null, status, verifyType);
      if (id !== null) {
        broadcast({ type: "new_log", log: { id, sn: SN, ...data } });
      }
    }
  } else {
    console.log(`[ZK] querydata unknown tablename: ${tablename}`);
  }

  res.type("text/plain").send("OK");
});

async function parseAndSaveUsers(sn: string, body: string, source: string) {
  const lines = body.split("\n");
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;

    const data: any = {};
    if (line.includes("\t")) {
      line.split("\t").forEach((p) => {
        const eq = p.indexOf("=");
        if (eq > -1) {
          const k = p.slice(0, eq).toLowerCase();
          data[k] = p.slice(eq + 1);
        }
      });
    } else {
      line.split(/\s(?=\w+=)/).forEach((part) => {
        const eq = part.indexOf("=");
        if (eq > -1) {
          const k = part.slice(0, eq).toLowerCase();
          data[k] = part.slice(eq + 1);
        }
      });
    }

    const pin = data.pin;
    const name = data.name || "";
    const privilege = parseInt(data.privilege ?? data.pri) || 0;
    const password = data.passwd || data.password || "";
    const card = data.card || data.cardno || "";

    if (pin) {
      await prisma.user.upsert({
        where: { pin },
        create: { pin, name, privilege, password, card },
        update: { name, privilege, password, card },
      });
      count++;
    }
  }
  console.log(`[ZK] ${source}: saved ${count} users from SN=${sn}`);
  broadcast({ type: "users_updated" });
}

async function parseAndSavePhotos(sn: string, body: string, kind: string, source: string): Promise<number> {
  const records = body.split(/(?=^(?:userpic|biophoto)\s)/m).map(r => r.trim()).filter(Boolean);
  let saved = 0;
  for (const rec of records) {
    const stripped = rec.replace(/^(userpic|biophoto)\s+/, "");
    const parts = stripped.split(/[\t\n]+/);
    const data: Record<string, string> = {};
    for (const p of parts) {
      const eq = p.indexOf("=");
      if (eq > -1) data[p.slice(0, eq).toLowerCase()] = p.slice(eq + 1);
    }

    const pin = data.pin;
    const b64 = data.content;
    if (!pin || !b64) continue;

    let buf: Buffer;
    try { buf = Buffer.from(b64.replace(/\s+/g, ""), "base64"); } catch { continue; }
    if (buf.length < 8) continue;

    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!isJpeg && !isPng) {
      console.log(`[ZK] ${source} pin=${pin}: not an image (likely template), skipping`);
      continue;
    }

    const filename = `${pin}.${isPng ? "png" : "jpg"}`;
    const fullPath = path.join(PHOTOS_DIR, filename);
    let same = false;
    try {
      if (fs.existsSync(fullPath)) {
        const existing = fs.readFileSync(fullPath);
        same = existing.length === buf.length && existing.equals(buf);
      }
    } catch {}
    if (!same) {
      fs.writeFileSync(fullPath, buf);
      if (s3) {
        try { await s3Upload(pin, buf); } catch (e) { console.error(`[S3] upload pin=${pin} error:`, e); }
      }
      await prisma.user.upsert({
        where: { pin },
        create: { pin, photo_path: s3 ? s3Key(pin) : filename, photo_blob: buf },
        update: { photo_path: s3 ? s3Key(pin) : filename, photo_blob: buf },
      });
    }
    console.log(`[ZK]   pin=${pin} ${same ? "(unchanged)" : "saved"} ${buf.length}B → ${filename}`);
    saved++;
  }
  console.log(`[ZK] ${source}: ${saved} photos from SN=${sn} (body ${body.length}B, ${records.length} records)`);
  if (saved === 0 && body.length > 0) {
    fs.appendFileSync(DEBUG_LOG, `\n[parseAndSavePhotos ${source}] 0 photos parsed. Body preview: ${body.slice(0, 400)}\n`);
  }
  if (saved > 0) {
    broadcast({ type: "users_updated" });
  }
  return saved;
}

// Resize/recompress to ≤20KB JPEG before sending to REP (Soltech-proven shape).
async function optimizeForRep(input: Buffer): Promise<Buffer> {
  const TARGET = 20 * 1024;
  let q = 90;
  let out = await sharp(input)
    .resize(358, 441, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: q, chromaSubsampling: "4:4:4" })
    .toBuffer();
  while (out.length > TARGET && q > 10) {
    q -= 5;
    out = await sharp(input)
      .resize(358, 441, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: q, chromaSubsampling: "4:4:4" })
      .toBuffer();
  }
  return out;
}

function generateOpId() {
  return `pop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function photoOpSetSuccess(opId: number, pin: string, operationId: string) {
  await prisma.photoOp.update({ where: { id: opId }, data: { status: "success" } });
  await prisma.user.update({ where: { pin }, data: { photo_synced_at: new Date() } });
  broadcast({ type: "photo_op_update", operation_id: operationId, status: "success", pin });
}

async function photoOpSetFailure(op: PhotoOp, detail: string) {
  const attempts = op.attempt_count + 1;
  const backoffSecs = [30, 60, 120, 300, 600];
  const delay = backoffSecs[Math.min(attempts - 1, backoffSecs.length - 1)];
  const nextRetry = new Date(Date.now() + delay * 1000);

  if (attempts >= op.max_attempts) {
    await prisma.photoOp.update({
      where: { id: op.id },
      data: { status: "critical", attempt_count: attempts, error_detail: detail },
    });
    console.log(`[ZK] photo_op ${op.operation_id} CRITICAL após ${attempts} tentativas: ${detail}`);
    broadcast({ type: "photo_op_update", operation_id: op.operation_id, status: "critical", pin: op.pin });
  } else {
    await prisma.photoOp.update({
      where: { id: op.id },
      data: { status: "error", attempt_count: attempts, next_retry_at: nextRetry, error_detail: detail },
    });
    console.log(`[ZK] photo_op ${op.operation_id} falhou (tentativa ${attempts}/${op.max_attempts}), retry em ${delay}s`);
    broadcast({ type: "photo_op_update", operation_id: op.operation_id, status: "error", pin: op.pin });
  }
}

async function enqueuePhotoUpdate(pin: string, jpeg: Buffer) {
  const b64 = jpeg.toString("base64");
  const hash = crypto.createHash("sha256").update(jpeg).digest("hex");
  const cmdBio = `DATA UPDATE BIOPHOTO PIN=${pin}\tType=9\tNo=0\tIndex=0\tSize=${b64.length}\tContent=${b64}\tFormat=0`;
  const cmdPic = `DATA UPDATE userpic pin=${pin}\tsize=${b64.length}\tformat=0\tcontent=${b64}`;
  const devices = await prisma.device.findMany({ select: { sn: true } });
  for (const dev of devices) {
    const opId = generateOpId();
    await prisma.command.create({ data: { sn: dev.sn, command: cmdBio } });
    const picCmd = await prisma.command.create({ data: { sn: dev.sn, command: cmdPic } });
    await prisma.photoOp.create({
      data: {
        operation_id: opId,
        sn: dev.sn,
        pin,
        op_type: "upsert",
        photo_hash: hash,
        command_id: picCmd.id,
      },
    });
  }
  await prisma.user.update({ where: { pin }, data: { photo_hash: hash, photo_synced_at: null } });
  console.log(`[ZK] photo update enqueued pin=${pin} hash=${hash.slice(0, 8)}... for ${devices.length} device(s)`);
}

async function enqueuePhotoDelete(pin: string) {
  const devices = await prisma.device.findMany({ select: { sn: true } });
  for (const dev of devices) {
    const opId = generateOpId();
    await prisma.command.create({ data: { sn: dev.sn, command: `DATA DELETE biophoto PIN=${pin}\tType=9` } });
    const delCmd = await prisma.command.create({ data: { sn: dev.sn, command: `DATA DELETE userpic pin=${pin}` } });
    await prisma.photoOp.create({
      data: { operation_id: opId, sn: dev.sn, pin, op_type: "delete", command_id: delCmd.id },
    });
  }
  console.log(`[ZK] photo delete enqueued pin=${pin} for ${devices.length} device(s)`);
}

async function enqueueUserUpsert(sn: string, pin: string, name: string, privilege: number, password: string, card: string): Promise<string> {
  const opId = generateOpId();
  const cmd = `DATA UPDATE user Pin=${pin}\tName=${name}\tPrivilege=${privilege}\tPassword=${password}\tCardNo=${card}`;
  const authCmd = `DATA UPDATE userauthorize Pin=${pin}\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1`;
  await prisma.command.create({ data: { sn, command: cmd } });
  const authRow = await prisma.command.create({ data: { sn, command: authCmd } });
  // Verificação pós-operação: força o REP a devolver a lista atualizada.
  await prisma.command.create({ data: { sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" } });
  await prisma.userOp.create({
    data: { operation_id: opId, sn, pin, op_type: "upsert", command_id: authRow.id },
  });
  return opId;
}

async function enqueueUserDelete(sn: string, pin: string): Promise<string> {
  const opId = generateOpId();
  const delCmd = await prisma.command.create({ data: { sn, command: `DATA DELETE user Pin=${pin}` } });
  await prisma.userOp.create({
    data: { operation_id: opId, sn, pin, op_type: "delete", command_id: delCmd.id },
  });
  await prisma.command.create({ data: { sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" } });
  return opId;
}

async function userOpSetFailure(op: UserOp, detail: string) {
  const attempts = op.attempt_count + 1;
  const backoffSecs = [30, 60, 120, 300, 600];
  const delay = backoffSecs[Math.min(attempts - 1, backoffSecs.length - 1)];
  const nextRetry = new Date(Date.now() + delay * 1000);
  if (attempts >= op.max_attempts) {
    await prisma.userOp.update({
      where: { id: op.id },
      data: { status: "critical", attempt_count: attempts, error_detail: detail },
    });
    console.log(`[ZK] user_op ${op.operation_id} CRITICAL: ${detail}`);
    broadcast({ type: "user_op_update", operation_id: op.operation_id, status: "critical", pin: op.pin });
  } else {
    await prisma.userOp.update({
      where: { id: op.id },
      data: { status: "error", attempt_count: attempts, next_retry_at: nextRetry, error_detail: detail },
    });
    broadcast({ type: "user_op_update", operation_id: op.operation_id, status: "error", pin: op.pin });
  }
}

// Retry loop: reprocessa ops pendentes/com erro a cada 60s.
// Usamos $queryRaw porque Prisma não suporta comparação coluna-coluna (attempt_count < max_attempts).
setInterval(async () => {
  try {
    // --- photo_ops ---
    const ops = await prisma.$queryRaw<PhotoOp[]>`
      SELECT * FROM photo_ops
      WHERE status IN ('pending','error')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND attempt_count < max_attempts
    `;

    for (const op of ops) {
      console.log(`[ZK] Retry photo_op ${op.operation_id} (tentativa ${op.attempt_count + 1})`);
      if (op.op_type === "upsert") {
        let jpeg: Buffer | null = null;
        if (s3) {
          jpeg = await s3Download(op.pin);
        } else {
          const user = await prisma.user.findUnique({ where: { pin: op.pin }, select: { photo_blob: true } });
          if (user?.photo_blob) jpeg = Buffer.from(user.photo_blob);
        }
        if (!jpeg) {
          await prisma.photoOp.update({
            where: { id: op.id },
            data: { status: "error", error_detail: s3 ? "foto ausente no S3" : "photo_blob ausente no banco" },
          });
          continue;
        }
        const b64 = jpeg.toString("base64");
        const hash = crypto.createHash("sha256").update(jpeg).digest("hex");
        await prisma.command.create({
          data: { sn: op.sn, command: `DATA UPDATE BIOPHOTO PIN=${op.pin}\tType=9\tNo=0\tIndex=0\tSize=${b64.length}\tContent=${b64}\tFormat=0` },
        });
        const picCmd = await prisma.command.create({
          data: { sn: op.sn, command: `DATA UPDATE userpic pin=${op.pin}\tsize=${b64.length}\tformat=0\tcontent=${b64}` },
        });
        await prisma.photoOp.update({
          where: { id: op.id },
          data: {
            command_id: picCmd.id,
            attempt_count: { increment: 1 },
            status: "pending",
            next_retry_at: null,
            photo_hash: hash,
          },
        });
        broadcast({ type: "photo_op_update", operation_id: op.operation_id, status: "pending", pin: op.pin });
      } else {
        await prisma.command.create({ data: { sn: op.sn, command: `DATA DELETE biophoto PIN=${op.pin}\tType=9` } });
        const delCmd = await prisma.command.create({ data: { sn: op.sn, command: `DATA DELETE userpic pin=${op.pin}` } });
        await prisma.photoOp.update({
          where: { id: op.id },
          data: {
            command_id: delCmd.id,
            attempt_count: { increment: 1 },
            status: "pending",
            next_retry_at: null,
          },
        });
        broadcast({ type: "photo_op_update", operation_id: op.operation_id, status: "pending", pin: op.pin });
      }
    }

    // --- user_ops ---
    const uops = await prisma.$queryRaw<UserOp[]>`
      SELECT * FROM user_ops
      WHERE status IN ('pending','error')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        AND attempt_count < max_attempts
    `;

    for (const op of uops) {
      console.log(`[ZK] Retry user_op ${op.operation_id} (tentativa ${op.attempt_count + 1})`);
      if (op.op_type === "upsert") {
        const user = await prisma.user.findUnique({
          where: { pin: op.pin },
          select: { name: true, privilege: true, password: true, card: true },
        });
        if (!user) {
          await prisma.userOp.update({
            where: { id: op.id },
            data: { status: "error", error_detail: "usuário não encontrado no banco" },
          });
          broadcast({ type: "user_op_update", operation_id: op.operation_id, status: "error", pin: op.pin });
          continue;
        }
        const cmd = `DATA UPDATE user Pin=${op.pin}\tName=${user.name}\tPrivilege=${user.privilege}\tPassword=${user.password || ""}\tCardNo=${user.card || ""}`;
        const auth = `DATA UPDATE userauthorize Pin=${op.pin}\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1`;
        await prisma.command.create({ data: { sn: op.sn, command: cmd } });
        const authRow = await prisma.command.create({ data: { sn: op.sn, command: auth } });
        await prisma.command.create({ data: { sn: op.sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" } });
        await prisma.userOp.update({
          where: { id: op.id },
          data: {
            command_id: authRow.id,
            attempt_count: { increment: 1 },
            status: "pending",
            next_retry_at: null,
          },
        });
        broadcast({ type: "user_op_update", operation_id: op.operation_id, status: "pending", pin: op.pin });
      } else {
        const delCmd = await prisma.command.create({ data: { sn: op.sn, command: `DATA DELETE user Pin=${op.pin}` } });
        await prisma.command.create({ data: { sn: op.sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" } });
        await prisma.userOp.update({
          where: { id: op.id },
          data: {
            command_id: delCmd.id,
            attempt_count: { increment: 1 },
            status: "pending",
            next_retry_at: null,
          },
        });
        broadcast({ type: "user_op_update", operation_id: op.operation_id, status: "pending", pin: op.pin });
      }
    }
  } catch (e) {
    console.error("[ZK] retry loop error:", e);
  }
}, 60_000);

// 3. Command Polling — gateway: Soltech autoritativo, zekateco como fallback.
// O REP só carrega um endereço de servidor, então pra a fila do zekateco
// chegar até ele este endpoint consulta o Soltech primeiro e, se ele não tiver
// nada (resposta "OK" sem comando), serve da fila local.
const SOLTECH_GATEWAY_URL = process.env.SOLTECH_GATEWAY_URL || "http://ultraponto-api:8080";
const SOLTECH_TIMEOUT_MS = parseInt(process.env.SOLTECH_TIMEOUT_MS || "5000");

app.get("/iclock/getrequest", async (req, res) => {
  const { SN } = req.query;
  if (SN) await updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  // 1) Soltech tem prioridade — é quem orquestra a base de usuários e jornadas.
  let soltechBody = "";
  try {
    const r = await fetch(`${SOLTECH_GATEWAY_URL}${req.originalUrl}`, {
      method: "GET",
      headers: { "User-Agent": (req.headers["user-agent"] as string) || "iClock Proxy" },
      signal: AbortSignal.timeout(SOLTECH_TIMEOUT_MS),
    });
    if (r.ok) {
      soltechBody = await r.text();
    } else {
      console.warn(`[ZK] getrequest gateway: Soltech HTTP ${r.status}; fallback para fila local`);
    }
  } catch (e: any) {
    console.warn(`[ZK] getrequest gateway: Soltech inacessível (${e.message}); fallback para fila local`);
  }

  // 2) Soltech entregou comando → repassa intacto, sem tocar na fila local.
  if (soltechBody.startsWith("C:")) {
    return res.type("text/plain").send(soltechBody);
  }

  // 3) Soltech sem comando — serve da fila do zekateco (UPDATE user/photo do dashboard).
  const command = await prisma.command.findFirst({
    where: { sn: SN as string, status: 0 },
    orderBy: { id: "asc" },
  });
  if (!command) {
    return res.type("text/plain").send(soltechBody || "OK");
  }
  await prisma.command.update({ where: { id: command.id }, data: { status: 1 } });
  const userOp = await prisma.userOp.findFirst({ where: { command_id: command.id, status: "pending" } });
  if (userOp) {
    await prisma.userOp.update({ where: { id: userOp.id }, data: { status: "sent" } });
    broadcast({ type: "user_op_update", operation_id: userOp.operation_id, status: "sent", pin: userOp.pin });
  }
  const photoOp = await prisma.photoOp.findFirst({ where: { command_id: command.id, status: "pending" } });
  if (photoOp) {
    await prisma.photoOp.update({ where: { id: photoOp.id }, data: { status: "sent" } });
    broadcast({ type: "photo_op_update", operation_id: photoOp.operation_id, status: "sent", pin: photoOp.pin });
  }
  res.type("text/plain").send(`C:${command.id}:${command.command}\r\n`);
});

// 4. Command Result
app.post("/iclock/devicecmd", async (req, res) => {
  const { SN } = req.query;
  const body = req.body as string;
  console.log(`[ZK] devicecmd from SN: ${SN}, body: ${body}`);
  if (SN) await updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  const match = body.match(/ID=(\d+)&Return=(-?\d+)/);
  if (match) {
    const cmdId = parseInt(match[1]);
    const ret = parseInt(match[2]);
    // Return ≥ 0 = success (N records). Negatives = error codes.
    // updateMany (em vez de update) e guarda count > 0: no setup mirror, o REP envia
    // acks de comandos enfileirados pelo Soltech — esses IDs não existem aqui.
    const upd = await prisma.command.updateMany({ where: { id: cmdId }, data: { status: ret >= 0 ? 2 : 3 } });
    if (upd.count === 0) {
      return res.type("text/plain").send("OK");
    }
    broadcast({ type: "command_result", id: cmdId, success: ret >= 0 });

    const photoOp = await prisma.photoOp.findFirst({ where: { command_id: cmdId } });
    if (photoOp) {
      const isDeleteNotFound = ret === -2 && photoOp.op_type === "delete";
      if (ret >= 0 || isDeleteNotFound) {
        await photoOpSetSuccess(photoOp.id, photoOp.pin, photoOp.operation_id);
      } else if (ret === -1) {
        await prisma.photoOp.update({
          where: { id: photoOp.id },
          data: { status: "critical", error_detail: "Return=-1 (comando não suportado)" },
        });
        broadcast({ type: "photo_op_update", operation_id: photoOp.operation_id, status: "critical", pin: photoOp.pin });
      } else {
        await photoOpSetFailure(photoOp, `Return=${ret}`);
      }
    }

    const userOp = await prisma.userOp.findFirst({ where: { command_id: cmdId } });
    if (userOp) {
      const isDeleteNotFound = ret === -2 && userOp.op_type === "delete";
      if (ret >= 0 || isDeleteNotFound) {
        await prisma.userOp.update({ where: { id: userOp.id }, data: { status: "success" } });
        broadcast({ type: "user_op_update", operation_id: userOp.operation_id, status: "success", pin: userOp.pin });
      } else if (ret === -1) {
        await prisma.userOp.update({
          where: { id: userOp.id },
          data: { status: "critical", error_detail: "Return=-1 (comando não suportado)" },
        });
        broadcast({ type: "user_op_update", operation_id: userOp.operation_id, status: "critical", pin: userOp.pin });
      } else {
        await userOpSetFailure(userOp, `Return=${ret}`);
      }
    }
  }

  res.type("text/plain").send("OK");
});

// --- API for Frontend ---

app.get("/api/config", (_req, res) => {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  res.json({ port });
});

app.get("/api/devices", async (_req, res) => {
  const devices = await prisma.device.findMany();
  const threshold = 5 * 60 * 1000;
  const now = Date.now();
  const result = devices.map((d) => ({
    ...d,
    last_seen: d.last_seen?.toISOString() ?? null,
    online: d.last_seen ? now - d.last_seen.getTime() < threshold : false,
  }));
  res.json(result);
});

app.get("/api/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      pin: true, name: true, privilege: true, password: true, card: true,
      photo_path: true, photo_hash: true, photo_synced_at: true, soltech_user_id: true,
    },
  });
  // Subquery MAX(id) GROUP BY pin — Prisma não tem equivalente direto.
  const latestPhotoOps = await prisma.$queryRaw<{ pin: string; status: string; operation_id: string; error_detail: string | null }[]>`
    SELECT pin, status, operation_id, error_detail FROM photo_ops
    WHERE id IN (SELECT MAX(id) FROM photo_ops GROUP BY pin)
  `;
  const latestUserOps = await prisma.$queryRaw<{ pin: string; status: string; operation_id: string; error_detail: string | null }[]>`
    SELECT pin, status, operation_id, error_detail FROM user_ops
    WHERE id IN (SELECT MAX(id) FROM user_ops GROUP BY pin)
  `;
  const photoOpByPin = new Map(latestPhotoOps.map(r => [r.pin, r]));
  const userOpByPin = new Map(latestUserOps.map(r => [r.pin, r]));

  const results = await Promise.all(users.map(async u => {
    const pop = photoOpByPin.get(u.pin);
    const uop = userOpByPin.get(u.pin);
    const photoSync = u.photo_path
      ? { status: pop?.status ?? "success", operation_id: pop?.operation_id ?? null, error_detail: pop?.error_detail ?? null }
      : null;
    const userSync = uop
      ? { status: uop.status, operation_id: uop.operation_id, error_detail: uop.error_detail }
      : null;
    const base = { ...u, photo_synced_at: u.photo_synced_at?.toISOString() ?? null };
    if (s3 && (u.soltech_user_id || u.photo_path)) {
      // Soltech photos take priority: biometrics/{soltechUserId}/face-photo.jpg
      const key = u.soltech_user_id
        ? `biometrics/${u.soltech_user_id}/face-photo.jpg`
        : s3Key(u.pin);
      const url = await s3PresignKey(key).catch(() => null);
      return { ...base, photo_url: url, photoSync: url ? photoSync : null, userSync };
    }
    if (!u.photo_path) return { ...base, photoSync, userSync };
    try {
      const v = Math.floor(fs.statSync(path.join(PHOTOS_DIR, u.photo_path)).mtimeMs);
      return { ...base, photo_url: `/photos/${u.photo_path}?v=${v}`, photoSync, userSync };
    } catch {
      return { ...base, photo_path: null, photoSync: null, userSync };
    }
  }));
  res.json(results);
});

// Mapeamento bulk: POST /api/soltech-ids  body: [{ pin, soltechUserId }]
app.post("/api/soltech-ids", express.json(), async (req, res) => {
  const mappings: { pin: string; soltechUserId: string }[] = req.body;
  if (!Array.isArray(mappings)) return res.status(400).json({ error: "Body deve ser um array de { pin, soltechUserId }" });
  let updated = 0;
  for (const { pin, soltechUserId } of mappings) {
    if (!pin || !soltechUserId) continue;
    await prisma.user.updateMany({ where: { pin }, data: { soltech_user_id: soltechUserId } });
    updated++;
  }
  broadcast({ type: "users_updated" });
  res.json({ success: true, updated });
});

// Mapeamento individual: PUT /api/users/:pin/soltech-id  body: { soltechUserId }
app.put("/api/users/:pin/soltech-id", express.json(), async (req, res) => {
  const { pin } = req.params;
  const { soltechUserId } = req.body;
  if (!soltechUserId) return res.status(400).json({ error: "soltechUserId obrigatório" });
  await prisma.user.updateMany({ where: { pin }, data: { soltech_user_id: soltechUserId } });
  broadcast({ type: "users_updated" });
  res.json({ success: true });
});

app.post("/api/users", express.json(), async (req, res) => {
  const { pin, name, privilege, password, card } = req.body;
  try {
    await prisma.user.create({
      data: { pin, name, privilege: privilege || 0, password: password || "", card: card || "" },
    });

    const devices = await prisma.device.findMany({ select: { sn: true } });
    for (const dev of devices) {
      await enqueueUserUpsert(dev.sn, pin, name, privilege || 0, password || "", card || "");
    }

    broadcast({ type: "users_updated" });
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/users/:pin", express.json(), async (req, res) => {
  const { pin } = req.params;
  const { name, privilege, password, card } = req.body;
  const existing = await prisma.user.findUnique({ where: { pin }, select: { pin: true } });
  if (!existing) return res.status(404).json({ error: "Usuário não encontrado" });

  await prisma.user.update({
    where: { pin },
    data: { name, privilege: privilege ?? 0, password: password ?? "", card: card ?? "" },
  });

  const devices = await prisma.device.findMany({ select: { sn: true } });
  for (const dev of devices) {
    await enqueueUserUpsert(dev.sn, pin, name, privilege ?? 0, password ?? "", card ?? "");
  }

  broadcast({ type: "users_updated" });
  res.json({ success: true });
});

app.delete("/api/users/:pin", async (req, res) => {
  const { pin } = req.params;
  await prisma.user.deleteMany({ where: { pin } });

  const devices = await prisma.device.findMany({ select: { sn: true } });
  for (const dev of devices) {
    await enqueueUserDelete(dev.sn, pin);
  }

  res.json({ success: true });
});

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.post("/api/users/:pin/photo", photoUpload.single("photo"), async (req, res) => {
  try {
    const { pin } = req.params;
    if (!req.file) return res.status(400).json({ error: "Arquivo 'photo' obrigatório" });

    const optimized = await optimizeForRep(req.file.buffer);
    const filename = `${pin}.jpg`;
    const hash = crypto.createHash("sha256").update(optimized).digest("hex");

    // 1) S3 primeiro (se configurado)
    if (s3) {
      await s3Upload(pin, optimized);
    } else {
      fs.writeFileSync(path.join(PHOTOS_DIR, filename), optimized);
    }

    await prisma.user.upsert({
      where: { pin },
      create: { pin, photo_blob: optimized, photo_path: s3 ? s3Key(pin) : filename, photo_hash: hash, photo_synced_at: null },
      update: { photo_blob: optimized, photo_path: s3 ? s3Key(pin) : filename, photo_hash: hash, photo_synced_at: null },
    });

    // 2) Enfileira pro REP
    await enqueuePhotoUpdate(pin, optimized);

    broadcast({ type: "users_updated" });
    res.json({ success: true, size: optimized.length });
  } catch (e: any) {
    console.error("[ZK] photo upload error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/users/:pin/photo/sync", async (req, res) => {
  const { pin } = req.params;
  let jpeg: Buffer | null = null;
  if (s3) {
    jpeg = await s3Download(pin);
    if (!jpeg) return res.status(404).json({ error: "Nenhuma foto no S3 para este usuário" });
  } else {
    const user = await prisma.user.findUnique({ where: { pin }, select: { photo_blob: true } });
    if (!user?.photo_blob) return res.status(404).json({ error: "Nenhuma foto no banco para este usuário" });
    jpeg = Buffer.from(user.photo_blob);
  }
  await enqueuePhotoUpdate(pin, jpeg);
  res.json({ success: true });
});

app.delete("/api/users/:pin/photo", async (req, res) => {
  const { pin } = req.params;
  // 1) Remove do S3 (se configurado) e do filesystem local
  if (s3) {
    try { await s3RemovePhoto(pin); } catch {}
  }
  try { fs.unlinkSync(path.join(PHOTOS_DIR, `${pin}.jpg`)); } catch {}
  await prisma.user.update({
    where: { pin },
    data: { photo_blob: null, photo_path: null, photo_hash: null, photo_synced_at: null },
  });
  // 2) Enfileira delete pro REP
  await enqueuePhotoDelete(pin);
  broadcast({ type: "users_updated" });
  res.json({ success: true });
});

// --- Photo Ops API ---

app.get("/api/photo-ops", async (req, res) => {
  const { pin, status } = req.query;
  const where: any = {};
  if (pin) where.pin = pin as string;
  if (status) where.status = status as string;
  const ops = await prisma.photoOp.findMany({
    where,
    select: {
      id: true, operation_id: true, sn: true, pin: true, op_type: true,
      status: true, attempt_count: true, max_attempts: true, photo_hash: true,
      error_detail: true, next_retry_at: true, created_at: true, updated_at: true,
    },
    orderBy: { id: "desc" },
    take: 100,
  });
  res.json(ops);
});

app.get("/api/photo-ops/metrics", async (_req, res) => {
  const rows = await prisma.$queryRaw<{
    total: bigint;
    total_success: bigint;
    pending_ops: bigint;
    total_critical: bigint;
    avg_attempts: number | null;
  }[]>`
    SELECT
      COUNT(*) AS total,
      SUM(status = 'success') AS total_success,
      SUM(status IN ('error','pending')) AS pending_ops,
      SUM(status = 'critical') AS total_critical,
      ROUND(AVG(attempt_count), 2) AS avg_attempts
    FROM photo_ops
  `;
  const r = rows[0];
  res.json({
    total: Number(r.total),
    total_success: Number(r.total_success),
    pending_ops: Number(r.pending_ops),
    total_critical: Number(r.total_critical),
    avg_attempts: r.avg_attempts,
  });
});

app.post("/api/photo-ops/:opId/retry", async (req, res) => {
  const op = await prisma.photoOp.findUnique({ where: { operation_id: req.params.opId } });
  if (!op) return res.status(404).json({ error: "Operação não encontrada" });
  await prisma.photoOp.update({
    where: { id: op.id },
    data: { status: "pending", next_retry_at: null, error_detail: null },
  });
  res.json({ success: true, message: "Operação reenfileirada" });
});

app.get("/api/logs", async (_req, res) => {
  const logs = await prisma.log.findMany({ orderBy: { id: "desc" }, take: 100 });
  res.json(logs);
});

app.post("/api/sync-users", async (_req, res) => {
  const devices = await prisma.device.findMany({ select: { sn: true } });
  if (devices.length === 0) {
    return res.status(400).json({ error: "Nenhum dispositivo conectado para sincronizar." });
  }

  for (const dev of devices) {
    await prisma.command.create({
      data: { sn: dev.sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" },
    });
  }

  res.json({ success: true, message: "Comando de sincronização enviado para todos os dispositivos." });
});

// --- Vite Setup ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  const os = await import("os");
  server.listen(PORT, "0.0.0.0", () => {
    const interfaces = os.networkInterfaces();
    let ip = "localhost";
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === "IPv4" && !iface.internal) {
          ip = iface.address;
          break;
        }
      }
    }
    console.log(`Server running on http://${ip}:${PORT}`);
  });
}

async function shutdown() {
  console.log("[ZK] shutting down...");
  await prisma.$disconnect();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startServer();
