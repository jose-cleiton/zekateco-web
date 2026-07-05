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

// Sobrescreve também a chave do Soltech (biometrics/<uuid>/face-photo.jpg) com
// a foto atualizada pelo REP — sem isso, o dashboard continuaria servindo a
// foto antiga do cadastro do Soltech.
async function s3UploadSoltech(soltechUserId: string, buf: Buffer): Promise<void> {
  await s3!.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `biometrics/${soltechUserId}/face-photo.jpg`,
    Body: buf,
    ContentType: "image/jpeg",
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

// --- Mirror inbound (Soltech → zekateco-web) --------------------------------
// O Soltech encaminha cópia de cada request ADMS para /__mirror/iclock/*.
// Valida o secret, marca a request como espelhada e reescreve a URL removendo
// o prefixo — a request cai nas rotas /iclock/* existentes, passando pelos
// MESMOS body parsers abaixo. Por isso precisa estar registrado antes deles.
const MIRROR_SECRET = process.env.MIRROR_SECRET || "";
app.use((req, res, next) => {
  if (!req.url.startsWith("/__mirror/")) return next();
  if (!MIRROR_SECRET || req.headers["x-mirror-secret"] !== MIRROR_SECRET) {
    return res.status(401).type("text/plain").send("unauthorized");
  }
  if (!req.url.startsWith("/__mirror/iclock/")) {
    return res.status(404).type("text/plain").send("not found");
  }
  // getrequest/devicecmd JAMAIS via mirror: além do read-only, o handler local
  // de getrequest consulta o Soltech (SOLTECH_GATEWAY_URL) e poderia CONSUMIR
  // um comando real da fila que o REP nunca receberia.
  // MAS mesmo bloqueando o processamento, aproveitamos a request pra registrar
  // o REP no dashboard — REPs em long-poll só fazem getrequest, sem isso não
  // sabíamos que eles existem.
  if (/^\/__mirror\/iclock\/(getrequest|devicecmd)\b/.test(req.url)) {
    const snMatch = /[?&]SN=([^&]+)/i.exec(req.url);
    if (snMatch) {
      const sn = decodeURIComponent(snMatch[1]);
      const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
      // Fire-and-forget — nunca bloqueia a resposta ao Soltech
      updateDeviceSeen(sn, ip, req).catch(() => {});
    }
    return res.status(204).end();
  }
  (req as any).mirrored = true;
  req.url = req.url.slice("/__mirror".length);
  next();
});

// --- Modo read-only ----------------------------------------------------------
// READ_ONLY=1 → nenhum comando é enfileirado pro REP; escritas em /api → 501
// (exceto mapeamentos locais de soltech-id, que não tocam o REP).
// READ_ONLY=0 mantém o comportamento antigo (REP direto na 8090, dev local).
const READ_ONLY = process.env.READ_ONLY === "1";
const READ_ONLY_ALLOW = [/^\/api\/soltech-ids$/, /^\/api\/users\/[^/]+\/soltech-id$/];
app.use("/api", (req, res, next) => {
  if (!READ_ONLY || req.method === "GET") return next();
  const pathOnly = req.originalUrl.split("?")[0];
  if (READ_ONLY_ALLOW.some((rx) => rx.test(pathOnly))) return next();
  res.status(501).json({ error: "Read-only mode — comandos via Soltech" });
});

// Body parser apenas para endpoints do REP (text/plain ou application/push).
// Sem isso, multer não receberia multipart porque text() consome qualquer Content-Type.
app.use("/iclock", express.text({ type: "*/*", limit: "10mb" }));
app.use("/iclock", express.urlencoded({ extended: true }));

const PHOTOS_DIR = path.join(__dirname, "photos");
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
app.use("/photos", express.static(PHOTOS_DIR, { etag: true, maxAge: 0 }));

wss.on("connection", (client, req) => {
  // Cliente conecta em /ws?sn=<SN> e recebe só mensagens daquele SN.
  // Sem ?sn=, recebe tudo (RepIndex precisa de device_update de todos).
  try {
    const sn = new URL(req.url || "", "http://localhost").searchParams.get("sn");
    if (sn) (client as any).sn = sn;
  } catch {}
  client.send(JSON.stringify({ type: "hello", boot_id: BOOT_ID }));
});

function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const room = (client as any).sn as string | undefined;
    if (room && data && typeof data.sn === "string" && data.sn !== room) return;
    client.send(JSON.stringify(data));
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

// SNs "de teste" que não devem virar devices no banco. Usados por health
// checks do CI e testes locais. Bloqueia poluição da tabela devices.
const IGNORED_SNS = /^(HEALTHCHECK|TEST|TESTE|PROBE|DEMO)/i;

async function updateDeviceSeen(sn: string, ip: string, req?: express.Request) {
  if (!sn || IGNORED_SNS.test(sn)) return;
  // X-Forwarded-For pode vir com múltiplos IPs (cadeia de proxies): o
  // primeiro (leftmost) é sempre o cliente original. Pegamos só ele pra
  // não guardar "1.2.3.4, 5.6.7.8" no campo Device.ip.
  if (ip && ip.includes(",")) ip = ip.split(",")[0].trim();
  const now = new Date();
  // Race protection: se duas requests do mesmo REP chegam concorrentes,
  // o upsert pode lançar P2002 no primeiro (ambos tentam create). Cai no
  // catch e refaz como update simples.
  try {
    await prisma.device.upsert({
      where: { sn },
      create: { sn, alias: sn, last_seen: now, ip },
      update: { last_seen: now, ip },
    });
  } catch (e: any) {
    if (e?.code === "P2002") {
      await prisma.device.update({ where: { sn }, data: { last_seen: now, ip } });
    } else {
      throw e;
    }
  }
  broadcast({ type: "device_update", sn, last_seen: now.toISOString(), online: true });

  // Requests espelhadas chegam pelo socket do axios do Soltech, não do REP —
  // rastreá-las no deviceSessions faria o idle-kill matar conexões keep-alive
  // do mirror à toa.
  if (req?.socket && !(req as any).mirrored) {
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

// Safety-net de sincronização: a cada 5 min, enfileira DATA QUERY user + biophoto
// pros REPs vistos recentemente. Cobre casos em que o OPERLOG não disparou
// (ex.: REP desconectou no meio de uma edição) e traz fotos de faces recém
// cadastradas no menu do REP. Guard contra duplicação por tipo de query.
setInterval(async () => {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const devices = await prisma.device.findMany({
    where: { last_seen: { gte: cutoff } },
    select: { sn: true },
  });
  for (const { sn } of devices) {
    const pendingUser = await prisma.command.count({
      where: { sn, status: 0, command: { startsWith: "DATA QUERY tablename=user" } },
    });
    if (pendingUser === 0) {
      await prisma.command.create({
        data: { sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" },
      });
    }
    const pendingBio = await prisma.command.count({
      where: { sn, status: 0, command: { startsWith: "DATA QUERY tablename=biophoto" } },
    });
    if (pendingBio === 0) {
      await prisma.command.create({
        data: { sn, command: "DATA QUERY tablename=biophoto,fielddesc=*,filter=Type=9" },
      });
    }
    // NOTA: pull de transaction desativado — no firmware SenseFace 7A,
    // 'DATA QUERY tablename=transaction' trava o REP (não devolve devicecmd
    // ack nem processa comandos subsequentes). Descoberto em 2026-07-04:
    // logs históricos só chegam via push automático (rtlog/ATTLOG) quando
    // acontecem em tempo real. Pra migrar histórico de outro DB, importar
    // manualmente via SQL.
  }
}, 5 * 60 * 1000);

async function queueInitialCommands(sn: string) {
  const pending = await prisma.command.count({ where: { sn, status: 0 } });
  if (pending === 0) {
    // Reaplica o estado de bloqueio salvo. Útil quando o REP foi resetado
    // ou perdeu config: garantimos que tap-to-wake bate com devices.locked.
    const device = await prisma.device.findUnique({ where: { sn } });
    const v = (device?.locked ?? true) ? 1 : 0;
    await prisma.command.createMany({
      data: [
        { sn, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" },
        // Biophotos (Type=9 = Visible Light Face). No firmware do SenseFace 7A
        // esse pull FUNCIONA (retorna as fotos em pacotes), populando photo_path
        // dos users sem precisar de re-cadastro manual.
        { sn, command: "DATA QUERY tablename=biophoto,fielddesc=*,filter=Type=9" },
        // NOTA: NÃO enfileirar 'DATA QUERY tablename=transaction' —
        // trava o REP nesse firmware. Logs vêm via push rtlog/ATTLOG.
        { sn, command: "SET OPTIONS FVInterval=7" },
        { sn, command: `SET OPTIONS OpenTouchWakeUp=${v},TouchWakeUp=${v}` },
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
  await updateDeviceSeen(SN as string, ip, req);

  // Sempre que o REP faz registry (reboot, reconexão), garantimos uma sync completa
  // de usuários. queueInitialCommands só enfileira se a fila estiver vazia, então
  // não duplica caso já tenha comandos pendentes.
  if (!READ_ONLY && !(req as any).mirrored) {
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
    // Captura completa da lista de capabilities (parametros expostos pelo firmware)
    // sem truncamento, em arquivo dedicado por SN, util pra descobrir chaves
    // de SET OPTIONS proprietarias do modelo.
    if (/^~DeviceName=|,FaceFunOn=/.test(body)) {
      try {
        fs.writeFileSync(path.join(PHOTOS_DIR, `_caps_${SN}.txt`), body);
        console.log(`[ZK] caps dump saved for SN=${SN} (${body.length} bytes)`);
      } catch {}
    }
    const photoLines = body.split("\n").filter(l => /^(USERPIC|BIOPHOTO|userpic|biophoto)\b/.test(l.trim()));
    if (photoLines.length > 0) {
      const kind = /^biophoto|^BIOPHOTO/.test(photoLines[0].trim()) ? "biophoto" : "userpic";
      await parseAndSavePhotos(SN as string, photoLines.join("\n"), kind, `cdata-OPERLOG-${kind}`);
    }
    // Detecta operações administrativas no REP (criar/editar/deletar user, mudar
    // config, etc) e enfileira uma resync. O firmware do SenseFace 7A não faz
    // push de USERINFO quando o admin edita pelo menu físico, então usamos o
    // OPERLOG como gatilho indireto. Conservador: dispara em qualquer OPLOG,
    // o prune da resposta querydata-user cuida de adds/edits/deletes.
    const hasOpLog = /^(OPLOG|USER|FP|FACE|FV)\b/m.test(body);
    if (hasOpLog) {
      const pending = await prisma.command.count({
        where: { sn: SN as string, status: 0, command: { startsWith: "DATA QUERY tablename=user" } },
      });
      if (pending === 0) {
        await prisma.command.create({
          data: { sn: SN as string, command: "DATA QUERY tablename=user,fielddesc=*,filter=*" },
        });
        console.log(`[ZK] OPERLOG detectado em ${SN}, sync de usuários enfileirada`);
      }
    }
  } else if (t === "USERINFO" || t === "user") {
    // SenseFace 7A faz push em table=user (lowercase) ao editar/criar pelo menu;
    // outras firmwares usam USERINFO. Tratamos ambos como atualização incremental
    // de um único user — não é sync completo, então isFinalPacket=false (sem prune).
    await parseAndSaveUsers(SN as string, body, `cdata-${t}`);
  } else if (t === "biodata" || t === "BIODATA" || t === "fingertmp" || t === "FINGERTMP") {
    // Template biométrico binário (Type=9 face, Type=1 fingerprint). Não
    // armazenamos local (já temos a foto JPEG via biophoto), só marcamos o
    // user como atualizado e notificamos o dashboard.
    const m = body.match(/pin=([\w-]+)/i);
    if (m) {
      const pin = m[1];
      const exists = await prisma.user.findUnique({ where: { pin }, select: { pin: true } });
      if (exists) {
        await prisma.user.update({ where: { pin }, data: { last_synced_at: new Date() } });
      }
      console.log(`[ZK] cdata-${t}: template recebido para pin=${pin}`);
      broadcast({ type: "users_updated" });
    }
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
    // Lista de capabilities do REP vem em table=options. Capturamos sem truncar
    // pra descobrir chaves SET OPTIONS proprietarias do firmware.
    if (t === "options" || /^~DeviceName=|,FaceFunOn=/.test(body || "")) {
      try {
        fs.writeFileSync(path.join(PHOTOS_DIR, `_caps_${SN}.txt`), body || "");
        console.log(`[ZK] caps dump saved for SN=${SN} (${(body || "").length} bytes)`);
      } catch {}
    }
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
    const packidx = parseInt(req.query.packidx as string) || 1;
    const packcnt = parseInt(req.query.packcnt as string) || 1;
    if (packidx === 1) userSyncSessions.set(SN as string, new Date());
    await parseAndSaveUsers(SN as string, body, "querydata-user", packidx === packcnt);
  } else if (tablename === "userpic" || tablename === "biophoto") {
    await parseAndSavePhotos(SN as string, body, tablename as string, `querydata-${tablename}`);
  } else if (tablename === "transaction") {
    // Formato do pull (diferente do push rtlog/ATTLOG):
    //   transaction index=NNN\tcardno=0\tpin=X\tverified=15\tdoorid=1\teventtype=3\tinoutstate=0\ttime_second=845882880
    // time_second não é Unix timestamp — usa encoding proprietário ZKTeco
    // (Appendix 5/6 do PDF): epoch 2000-01-01, "meses de 31 dias" pra codificação.
    const lines = body.split("\n");
    let parsed = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const data: Record<string, string> = {};
      // Delimitador pode ser \t (pull) ou espaço+chave= (push rtlog)
      const parts = line.includes("\t") ? line.split("\t") : line.split(/\s(?=\w+=)/);
      for (const p of parts) {
        const eq = p.indexOf("=");
        if (eq > -1) data[p.slice(0, eq).trim()] = p.slice(eq + 1);
      }

      if (!data.pin || data.pin === "0") continue;

      // Decodifica time_second (ZKTeco proprietary) → Date
      let timeISO: string | null = null;
      if (data.time_second) {
        let tt = parseInt(data.time_second) || 0;
        const sec = tt % 60; tt = Math.floor(tt / 60);
        const min = tt % 60; tt = Math.floor(tt / 60);
        const hour = tt % 24; tt = Math.floor(tt / 24);
        const day = (tt % 31) + 1; tt = Math.floor(tt / 31);
        const mon = (tt % 12) + 1; tt = Math.floor(tt / 12);
        const year = tt + 2000;
        // ZKTeco encoding tem "meses de 31 dias" — datas 29-31/fev são impossíveis
        // no calendário real, mas o REP não gera essas datas naturalmente.
        // JavaScript Date lida com overflow (ex: mês 2 dia 30 vira mês 3 dia 2)
        // mas nesse encoding proprietário isso não deve acontecer.
        const d = new Date(Date.UTC(year, mon - 1, day, hour, min, sec));
        if (!isNaN(d.getTime())) timeISO = d.toISOString();
      } else if (data.time) {
        // Push (rtlog/ATTLOG) usa formato string legível — usa direto
        timeISO = data.time;
      }

      // Mapeia campos ZKTeco → nosso schema
      // inoutstate: 0=entrada, 1=saída, 2=outros
      // verified: 1=digital, 15=face, 200=?, etc (mapeamento parcial)
      const status = parseInt(data.inoutstate ?? data.status) || 0;
      const verifyType = parseInt(data.verified ?? data.verify) || 0;

      const id = await insertLogIgnoreDup(SN as string, data.pin, timeISO, status, verifyType);
      if (id !== null) {
        parsed++;
        broadcast({ type: "new_log", log: { id, sn: SN, pin: data.pin, time: timeISO, status, verify_type: verifyType } });
      }
    }
    if (parsed > 0) console.log(`[ZK] querydata-transaction: saved ${parsed} logs from SN=${SN}`);
  } else {
    console.log(`[ZK] querydata unknown tablename: ${tablename}`);
  }

  res.type("text/plain").send("OK");
});

// Rastreia início de cada sessão de sync completa (DATA QUERY tablename=user paginado).
// Quando o último pacote chega, deletamos vínculos antigos e usuários órfãos.
const userSyncSessions = new Map<string, Date>();

async function pruneStaleUsersForSn(sn: string, syncStart: Date) {
  const removedLinks = await prisma.userDevice.deleteMany({
    where: { sn, last_synced_at: { lt: syncStart } },
  });
  const orphans = await prisma.$executeRaw`
    DELETE FROM users WHERE pin NOT IN (SELECT pin FROM user_devices)
  `;
  console.log(`[ZK] prune SN=${sn}: removed ${removedLinks.count} stale links, ${orphans} orphan users`);
  if (removedLinks.count > 0 || orphans > 0) {
    broadcast({ type: "users_updated" });
  }
}

async function parseAndSaveUsers(sn: string, body: string, source: string, isFinalPacket = false) {
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
      const now = new Date();
      await prisma.user.upsert({
        where: { pin },
        create: { pin, name, privilege, password, card, last_synced_at: now },
        update: { name, privilege, password, card, last_synced_at: now },
      });
      await prisma.userDevice.upsert({
        where: { pin_sn: { pin, sn } },
        create: { pin, sn },
        update: { last_synced_at: now },
      });
      count++;
    }
  }
  console.log(`[ZK] ${source}: saved ${count} users from SN=${sn}`);
  broadcast({ type: "users_updated" });

  if (isFinalPacket) {
    const syncStart = userSyncSessions.get(sn);
    userSyncSessions.delete(sn);
    if (syncStart) {
      await pruneStaleUsersForSn(sn, syncStart);
    }
  }
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
        // Se o user tem soltech_user_id, sobrescreve também a chave do Soltech
        // (biometrics/<uuid>/face-photo.jpg) pra que o dashboard — que serve dessa
        // chave — exiba a foto atualizada pelo REP em tempo real.
        try {
          const existing = await prisma.user.findUnique({ where: { pin }, select: { soltech_user_id: true } });
          if (existing?.soltech_user_id) {
            await s3UploadSoltech(existing.soltech_user_id, buf);
          }
        } catch (e) {
          console.error(`[S3] soltech upload pin=${pin} error:`, e);
        }
      }
      const now = new Date();
      await prisma.user.upsert({
        where: { pin },
        create: { pin, photo_path: s3 ? s3Key(pin) : filename, photo_blob: buf, last_synced_at: now },
        update: { photo_path: s3 ? s3Key(pin) : filename, photo_blob: buf, last_synced_at: now },
      });
      await prisma.userDevice.upsert({
        where: { pin_sn: { pin, sn } },
        create: { pin, sn },
        update: { last_synced_at: now },
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

    // Se for ack de um DATA QUERY transaction chunk histórico, enfileira o
    // próximo da fila (serialização — evita bombardear o REP).
    const cmd = await prisma.command.findUnique({ where: { id: cmdId }, select: { sn: true, command: true } });
    if (cmd?.command?.startsWith("DATA QUERY tablename=transaction") && cmd.command.includes("StartTime=")) {
      await enqueueNextHistoricChunk(cmd.sn!);
    }

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
  res.json({ port, read_only: READ_ONLY });
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

// Resolve IP público → REP(s). Retorna LISTA: REPs atrás do mesmo NAT
// compartilham IP público; o front trata a colisão com um seletor.
app.get("/api/devices/by-ip/:ip", async (req, res) => {
  const devices = await prisma.device.findMany({ where: { ip: req.params.ip } });
  const threshold = 5 * 60 * 1000;
  const now = Date.now();
  res.json(
    devices.map((d) => ({
      sn: d.sn,
      ip: d.ip,
      alias: d.alias,
      locked: d.locked,
      last_seen: d.last_seen?.toISOString() ?? null,
      online: d.last_seen ? now - d.last_seen.getTime() < threshold : false,
    })),
  );
});

// Enfileira SET OPTIONS <chave>=<valor> para o REP. O resultado real
// (Return=N do devicecmd) aparece nos logs do backend após o REP processar.
app.post("/api/devices/:sn/options", express.json(), async (req, res) => {
  const { sn } = req.params;
  const options = (req.body || {}) as Record<string, string | number>;
  if (!sn || Object.keys(options).length === 0) {
    return res.status(400).json({ error: "Informe ao menos uma opção" });
  }
  const device = await prisma.device.findUnique({ where: { sn } });
  if (!device) return res.status(404).json({ error: "REP não encontrado" });

  const created: { id: number; command: string }[] = [];
  for (const [key, value] of Object.entries(options)) {
    const command = `SET OPTIONS ${key}=${value}`;
    const c = await prisma.command.create({ data: { sn, command } });
    created.push({ id: c.id, command });
  }
  res.json({ success: true, queued: created });
});

// Bloqueia/desbloqueia a verificação biométrica do REP.
// locked=true → ativa modo "tap to wake": camera/verificação dorme até toque na tela.
// locked=false → desativa, REP volta a reconhecer continuamente.
// As chaves OpenTouchWakeUp/TouchWakeUp são proprietárias do SenseFace 7A; só
// surtem efeito após reboot do REP, então enfileiramos CONTROL DEVICE em seguida.
app.post("/api/devices/:sn/lock", express.json(), async (req, res) => {
  const { sn } = req.params;
  const locked = !!req.body?.locked;
  const device = await prisma.device.findUnique({ where: { sn } });
  if (!device) return res.status(404).json({ error: "REP não encontrado" });

  await prisma.device.update({ where: { sn }, data: { locked } });
  const v = locked ? 1 : 0;
  const setCmd = await prisma.command.create({
    data: { sn, command: `SET OPTIONS OpenTouchWakeUp=${v},TouchWakeUp=${v}` },
  });
  const rebootCmd = await prisma.command.create({
    data: { sn, command: "CONTROL DEVICE 03000000" },
  });
  broadcast({ type: "device_update", sn });
  res.json({ success: true, locked, commandIds: [setCmd.id, rebootCmd.id] });
});

// Otimiza imagem (wallpaper/promotion) pra caber no command do ADMS sem
// estourar buffer. Resolução típica 480x800 (face REPs verticais).
async function optimizeForRepMedia(input: Buffer, maxKB = 200): Promise<Buffer> {
  let q = 85;
  let out = await sharp(input)
    .resize(480, 800, { fit: "cover", position: "center" })
    .jpeg({ quality: q })
    .toBuffer();
  while (out.length > maxKB * 1024 && q > 30) {
    q -= 10;
    out = await sharp(input)
      .resize(480, 800, { fit: "cover", position: "center" })
      .jpeg({ quality: q })
      .toBuffer();
  }
  return out;
}

const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Enfileira upload de adpic com DELETE prévio do mesmo slot, garantindo
// substituição limpa quando o REP já tem imagem no índice.
async function enqueueAdpic(sn: string, index: number, buf: Buffer, ext: "jpg" | "png") {
  await prisma.command.create({ data: { sn, command: `DATA DELETE adpic index=${index}` } });
  const content = buf.toString("base64");
  const c = await prisma.command.create({
    data: { sn, command: `DATA UPDATE adpic index=${index}\tsize=${buf.length}\textension=${ext}\tcontent=${content}` },
  });
  return c;
}

// Lista as imagens (adpics) cadastradas pra um REP. Cada item inclui um thumbnail
// inline em base64 pra preview no dashboard sem requisição extra.
app.get("/api/devices/:sn/media", async (req, res) => {
  const { sn } = req.params;
  const items = await prisma.deviceMedia.findMany({
    where: { sn },
    orderBy: { idx: "asc" },
    select: { idx: true, size: true, ext: true, thumbnail: true, created_at: true },
  });
  res.json(items.map((m) => ({
    idx: m.idx,
    sizeKB: Math.round(m.size / 1024),
    ext: m.ext,
    created_at: m.created_at.toISOString(),
    thumbnail: m.thumbnail
      ? `data:image/jpeg;base64,${m.thumbnail.toString("base64")}`
      : null,
  })));
});

// Envia uma imagem nova pro slideshow do REP. Se index não vier no body,
// usa o próximo livre. Otimiza com sharp pra <=300KB JPEG e gera um thumbnail
// pequeno (<=15KB) pra preview no dashboard.
app.post("/api/devices/:sn/media", mediaUpload.single("image"), async (req, res) => {
  const { sn } = req.params;
  if (!req.file) return res.status(400).json({ error: "Imagem não enviada (campo 'image')" });
  const device = await prisma.device.findUnique({ where: { sn } });
  if (!device) return res.status(404).json({ error: "REP não encontrado" });

  try {
    // Determina próximo idx livre se nenhum foi informado.
    let idx = parseInt((req.body?.index as string) || "0") || 0;
    if (!idx) {
      const used = await prisma.deviceMedia.findMany({ where: { sn }, select: { idx: true } });
      const set = new Set(used.map((u) => u.idx));
      for (let i = 1; i <= 100; i++) {
        if (!set.has(i)) { idx = i; break; }
      }
    }

    const mime = req.file.mimetype || "";
    const ext: "jpg" | "png" = mime.includes("png") ? "png" : "jpg";
    const out = ext === "png"
      ? await sharp(req.file.buffer).png({ compressionLevel: 9 }).toBuffer()
      : await optimizeForRepMedia(req.file.buffer, 300);

    // Thumb pequeno (~96x160) pra preview no dashboard.
    const thumb = await sharp(req.file.buffer)
      .resize(96, 160, { fit: "cover", position: "center" })
      .jpeg({ quality: 70 })
      .toBuffer();

    const c = await enqueueAdpic(sn, idx, out, ext);
    await prisma.deviceMedia.upsert({
      where: { sn_idx: { sn, idx } },
      create: { sn, idx, size: out.length, ext, thumbnail: thumb },
      update: { size: out.length, ext, thumbnail: thumb, created_at: new Date() },
    });
    console.log(`[ZK] media queued: cmd=${c.id} sn=${sn} idx=${idx} ext=${ext} bytes=${out.length}`);
    res.json({ success: true, commandId: c.id, idx, sizeKB: Math.round(out.length / 1024), ext });
  } catch (e: any) {
    console.error("[ZK] media error:", e);
    res.status(500).json({ error: e.message });
  }
});

// Remove uma imagem específica do REP por índice.
app.delete("/api/devices/:sn/media/:idx", async (req, res) => {
  const { sn } = req.params;
  const idx = parseInt(req.params.idx);
  if (!idx) return res.status(400).json({ error: "Índice inválido" });
  await prisma.deviceMedia.deleteMany({ where: { sn, idx } });
  const c = await prisma.command.create({ data: { sn, command: `DATA DELETE adpic index=${idx}` } });
  res.json({ success: true, commandId: c.id });
});

// Apaga TODOS os userpic (avatares dos usuários cadastrados) do REP.
// O userpic é o que entra no slideshow do equipamento quando ele fica ocioso —
// é distinto do BIOPHOTO/template usado pra reconhecer face, então deletar
// userpic NÃO quebra a autenticação biométrica.
app.post("/api/devices/:sn/userpics/clear", async (req, res) => {
  const { sn } = req.params;
  const device = await prisma.device.findUnique({ where: { sn } });
  if (!device) return res.status(404).json({ error: "REP não encontrado" });
  // 1) Wildcard global (alguns firmwares aceitam).
  const cmds: number[] = [];
  const wildcard = await prisma.command.create({ data: { sn, command: "DATA DELETE userpic pin=*" } });
  cmds.push(wildcard.id);
  // 2) Por PIN conhecido (fallback robusto).
  const links = await prisma.userDevice.findMany({ where: { sn }, select: { pin: true } });
  for (const { pin } of links) {
    const c = await prisma.command.create({ data: { sn, command: `DATA DELETE userpic pin=${pin}` } });
    cmds.push(c.id);
  }
  res.json({ success: true, queued: cmds.length });
});

// Limpa todas as adpics do REP + apaga registros locais.
app.post("/api/devices/:sn/media/clear", async (req, res) => {
  const { sn } = req.params;
  const device = await prisma.device.findUnique({ where: { sn } });
  if (!device) return res.status(404).json({ error: "REP não encontrado" });
  await prisma.deviceMedia.deleteMany({ where: { sn } });
  // Wildcard + 10 índices explícitos (nem todo firmware suporta o *).
  const cmds: number[] = [];
  const wildcard = await prisma.command.create({ data: { sn, command: "DATA DELETE adpic *" } });
  cmds.push(wildcard.id);
  for (let i = 1; i <= 10; i++) {
    const c = await prisma.command.create({ data: { sn, command: `DATA DELETE adpic index=${i}` } });
    cmds.push(c.id);
  }
  res.json({ success: true, queued: cmds.length });
});

// Reinicia o REP via comando REBOOT.
app.post("/api/devices/:sn/reboot", async (req, res) => {
  const { sn } = req.params;
  const device = await prisma.device.findUnique({ where: { sn } });
  if (!device) return res.status(404).json({ error: "REP não encontrado" });
  const c = await prisma.command.create({ data: { sn, command: "REBOOT" } });
  res.json({ success: true, commandId: c.id });
});

app.get("/api/users", async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      pin: true, name: true, privilege: true, password: true, card: true,
      photo_path: true, photo_hash: true, photo_synced_at: true, soltech_user_id: true,
      last_synced_at: true,
      devices: { select: { sn: true, last_synced_at: true } },
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
  type OpRow = { pin: string; status: string; operation_id: string; error_detail: string | null };
  const photoOpByPin = new Map<string, OpRow>(latestPhotoOps.map((r) => [r.pin, r]));
  const userOpByPin = new Map<string, OpRow>(latestUserOps.map((r) => [r.pin, r]));

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
      // Foto do Soltech (biometrics/<uuid>/face-photo.jpg) é a chave canônica
      // exibida no dashboard. Quando o REP empurra uma foto nova via push, o
      // parseAndSavePhotos já sobrescreve essa mesma chave (via s3UploadSoltech),
      // então o dashboard reflete a atualização sem mudar o photo_url.
      // Cache-busting com last_synced_at força o browser a refetchar a URL.
      const key = u.soltech_user_id
        ? `biometrics/${u.soltech_user_id}/face-photo.jpg`
        : s3Key(u.pin);
      let url = await s3PresignKey(key).catch(() => null);
      // Cache-busting via fragment (#) — não vai pro S3, então não quebra a
      // assinatura presigned. Browser trata #v=N como URL diferente e refetch.
      if (url && u.last_synced_at) {
        url = `${url}#v=${u.last_synced_at.getTime()}`;
      }
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

// Lista logs de ponto. Sem query params: retorna os 500 mais recentes (default
// razoável pro dashboard). Com from/to: filtra por período no banco (índice em
// logs.time cuida da performance). Sem LIMIT quando filtro é aplicado — relatório
// pode precisar de milhares de linhas de meses passados.
app.get("/api/logs", async (req, res) => {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  const where: { time?: { gte?: Date; lte?: Date } } = {};
  if (from && !isNaN(from.getTime())) where.time = { ...(where.time || {}), gte: from };
  if (to && !isNaN(to.getTime())) where.time = { ...(where.time || {}), lte: to };

  const hasFilter = Object.keys(where).length > 0;
  const logs = await prisma.log.findMany({
    where,
    orderBy: { time: "desc" },
    take: hasFilter ? 10000 : 500, // sem filtro: só recentes; com filtro: até 10k
  });
  res.json(logs);
});

// Estado da sincronização histórica de logs. Serializado no processo Node:
// enfileiramos 1 chunk por vez; o handler devicecmd (Return=N) puxa o próximo.
// Armazena por SN → array de chunks pendentes.
const historicSyncQueues = new Map<string, { start: string; end: string }[]>();

async function enqueueNextHistoricChunk(sn: string) {
  const queue = historicSyncQueues.get(sn);
  if (!queue || queue.length === 0) return;
  const next = queue.shift()!;
  await prisma.command.create({
    data: {
      sn,
      command: `DATA QUERY tablename=transaction,fielddesc=*,filter=StartTime=${next.start},EndTime=${next.end}`,
    },
  });
  console.log(`[ZK] sync-historic: enfileirado chunk ${next.start} → ${next.end} pra SN=${sn} (${queue.length} restantes)`);
}

// Sincroniza histórico de logs do REP em janelas MENSAIS SERIALIZADAS.
// filter=* sem data trava o firmware, e enfileirar múltiplos chunks de uma
// vez também trava. Enfileiramos só o primeiro; conforme o REP ack cada um,
// o handler devicecmd chama enqueueNextHistoricChunk automaticamente.
app.post("/api/sync-logs-historic", express.json(), async (req, res) => {
  const from = req.body?.from ? new Date(req.body.from) : null;
  const to = req.body?.to ? new Date(req.body.to) : new Date();
  if (!from || isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: "Passe from (YYYY-MM-DD) e opcionalmente to." });
  }
  const devices = await prisma.device.findMany({ select: { sn: true } });
  if (devices.length === 0) return res.status(400).json({ error: "Nenhum REP conectado." });

  const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
  const cursor = new Date(from.getTime());
  cursor.setUTCDate(1);
  const chunks: { start: string; end: string }[] = [];
  while (cursor < to) {
    const start = new Date(cursor);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const end = new Date(Math.min(cursor.getTime(), to.getTime()) - 1000);
    chunks.push({ start: fmt(start), end: fmt(end) });
  }

  let totalPlanned = 0;
  for (const dev of devices) {
    historicSyncQueues.set(dev.sn, [...chunks]);
    totalPlanned += chunks.length;
    await enqueueNextHistoricChunk(dev.sn);
  }
  res.json({ success: true, chunks_per_device: chunks.length, devices: devices.length, total_planned: totalPlanned });
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
