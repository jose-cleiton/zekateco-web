import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("zkteco.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS devices (
    sn TEXT PRIMARY KEY,
    alias TEXT,
    last_seen DATETIME,
    ip TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    pin TEXT PRIMARY KEY,
    name TEXT,
    privilege INTEGER DEFAULT 0,
    password TEXT,
    card TEXT,
    group_id INTEGER DEFAULT 1,
    photo_path TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sn TEXT,
    pin TEXT,
    time DATETIME,
    status INTEGER,
    verify_type INTEGER
  );

  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sn TEXT,
    command TEXT,
    status INTEGER DEFAULT 0, -- 0: Pending, 1: Sent, 2: Success, 3: Error
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  db.exec("ALTER TABLE users ADD COLUMN photo_path TEXT");
} catch (e: any) {
  if (!String(e.message).includes("duplicate column")) throw e;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const BOOT_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

app.use(express.text({ type: "*/*", limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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
    // First 400 chars + size — enough to identify format without dumping base64.
    const preview = body.length > 400 ? body.slice(0, 400) + `... [+${body.length - 400} bytes]` : body;
    fs.appendFileSync(DEBUG_LOG, `\n--- ${new Date().toISOString()} SN=${sn} ${label} (${body.length} bytes) ---\n${preview}\n`);
  } catch {}
}

function updateDeviceSeen(sn: string, ip: string, req?: express.Request) {
  const now = new Date().toISOString();
  const exists = db.prepare("SELECT sn FROM devices WHERE sn = ?").get(sn);
  if (exists) {
    db.prepare("UPDATE devices SET last_seen = ?, ip = ? WHERE sn = ?").run(now, ip, sn);
  } else {
    db.prepare("INSERT INTO devices (sn, alias, last_seen, ip) VALUES (?, ?, ?, ?)").run(sn, sn, now, ip);
  }
  broadcast({ type: "device_update", sn, last_seen: now, online: true });

  if (req?.socket) {
    const prev = deviceSessions.get(sn);
    if (prev && prev.socket !== req.socket && !prev.socket.destroyed) {
      // REP opened a new socket — drop the old zombie immediately.
      prev.socket.destroy();
    }
    deviceSessions.set(sn, { socket: req.socket, lastSeen: Date.now() });
    // HTTP keep-alive reuses the same socket across requests; only attach the
    // close listener once per socket to avoid MaxListenersExceededWarning.
    const sock = req.socket as any;
    if (!sock._zkCloseAttached) {
      sock._zkCloseAttached = true;
      sock._zkSn = sn;
      req.socket.once("close", () => {
        const cur = deviceSessions.get(sock._zkSn);
        if (cur?.socket === req.socket) deviceSessions.delete(sock._zkSn);
      });
    } else {
      sock._zkSn = sn; // keep mapping fresh in case SN changes on reuse (rare)
    }
  } else {
    const cur = deviceSessions.get(sn);
    if (cur) cur.lastSeen = Date.now();
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [sn, sess] of deviceSessions.entries()) {
    if (now - sess.lastSeen > IDLE_KILL_MS && !sess.socket.destroyed) {
      console.log(`[ZK] Idle reaper: closing socket for SN=${sn} (idle ${Math.round((now - sess.lastSeen) / 1000)}s)`);
      sess.socket.destroy();
      deviceSessions.delete(sn);
      broadcast({ type: "device_update", sn, online: false });
    }
  }
}, 15_000);

function queueInitialCommands(sn: string) {
  const pending = db.prepare("SELECT COUNT(*) as c FROM commands WHERE sn = ? AND status = 0").get(sn) as any;
  if (pending.c === 0) {
    db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(sn, "DATA QUERY tablename=user,fielddesc=*,filter=*");
    db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(sn, "SET OPTIONS FVInterval=7");
  }
}

// --- ZKTeco ADMS Endpoints ---

// Heartbeat
app.get("/iclock/ping", (req, res) => {
  const { SN } = req.query;
  if (SN) {
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
    updateDeviceSeen(SN as string, ip, req);
  }
  res.type("text/plain").send("OK");
});

// 0. Handshake / Registry
app.post("/iclock/registry", (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] Registry from SN: ${SN}`);
  if (!SN) {
    return res.type("text/plain").send("RegistryCode=0\n");
  }

  const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
  const isNew = !db.prepare("SELECT sn FROM devices WHERE sn = ?").get(SN as string);
  updateDeviceSeen(SN as string, ip, req);

  if (isNew) {
    queueInitialCommands(SN as string);
  }

  res.type("text/plain").send(`RegistryCode=REP_${SN}_abcd79\n`);
});

// 0b. Configuration Download (POST push)
app.post("/iclock/push", (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] push from SN: ${SN}`);
  if (SN) {
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
    updateDeviceSeen(SN as string, ip, req);
  }
  res.type("text/plain").send("OK");
});

// 1. Initialization and Polling (GET)
app.get("/iclock/cdata", (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] cdata GET from SN: ${SN}`);

  if (SN) {
    const ip = (req.headers["x-forwarded-for"] as string) || req.ip || "";
    const device = db.prepare("SELECT sn FROM devices WHERE sn = ?").get(SN as string);
    updateDeviceSeen(SN as string, ip, req);

    if (device) {
      return res.type("text/plain").send(
        `registry=ok\nRegistryCode=REG_${SN}_xyz789\nServerVersion=3.1.2\nPushProtVer=3.1.2\nRequestDelay=30\nTransTimes=00:00;14:00\nTransInterval=1\nRealtime=1\nBioPhotoFun=1\nBioDataFun=1\nEncryption=None`
      );
    }
  }

  res.type("text/plain").send("OK");
});

// 2. Data Upload — real-time logs and tabledata (POST cdata)
app.post("/iclock/cdata", (req, res) => {
  const { SN, table, tablename, Stamp } = req.query;
  const body = req.body as string;
  // Photo uploads use ?tablename=userpic|biophoto; ATTLOG/rtlog use ?table=...
  const t = (tablename as string) || (table as string);
  console.log(`[ZK] cdata POST from SN: ${SN}, table: ${t}, stamp: ${Stamp}`);
  if (SN) updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  if (t === "rtlog" || t === "ATTLOG") {
    // rtlog format: "pin=1001 time=2024-04-25 10:30:45 ..."
    // ATTLOG format: "PIN\tTIME\tSTATUS\tVERIFY_TYPE"
    const lines = body.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;

      let pin: string, time: string, status: string, verifyType: string;

      if (t === "rtlog") {
        const data: any = {};
        line.split(/\s(?=\w+=)/).forEach((part) => {
          const eq = part.indexOf("=");
          if (eq > -1) data[part.slice(0, eq)] = part.slice(eq + 1);
        });
        pin = data.pin; time = data.time; status = data.status || "0"; verifyType = data.verify || "0";
      } else {
        [pin, time, status, verifyType] = line.split("\t");
      }

      if (!pin) continue;
      const info = db.prepare("INSERT INTO logs (sn, pin, time, status, verify_type) VALUES (?, ?, ?, ?, ?)")
        .run(SN as string, pin, time, status || 0, verifyType || 0);
      broadcast({ type: "new_log", log: { id: info.lastInsertRowid, sn: SN, pin, time, status, verifyType } });
    }
  } else if (t === "OPERLOG") {
    debugDump(SN as string, "cdata-OPERLOG", body);
    console.log(`[ZK] OperLog from ${SN} (${body.length} bytes)`);
    // Some firmwares send USERPIC/BIOPHOTO records inside OPERLOG batches.
    const photoLines = body.split("\n").filter(l => /^(USERPIC|BIOPHOTO|userpic|biophoto)\b/.test(l.trim()));
    if (photoLines.length > 0) {
      const kind = /^biophoto|^BIOPHOTO/.test(photoLines[0].trim()) ? "biophoto" : "userpic";
      parseAndSavePhotos(SN as string, photoLines.join("\n"), kind, `cdata-OPERLOG-${kind}`);
    }
  } else if (t === "USERINFO") {
    // Legacy: some devices still send USERINFO via cdata POST
    parseAndSaveUsers(SN as string, body, "cdata-USERINFO");
  } else if (t === "userpic" || t === "biophoto") {
    debugDump(SN as string, `cdata-${t}`, body);
    const count = parseAndSavePhotos(SN as string, body, t, `cdata-${t}`);
    res.set("Connection", "close");
    return res.type("text/plain").send(`${t}=${count}\n`);
  } else if (t === "tabledata" || /^(biophoto|userpic)\b/.test(body.trimStart())) {
    // Push automático após cadastro: device manda `?table=tabledata` com
    // body começando em `biophoto<TAB>pin=...<TAB>content=<base64>`. Detectado
    // tanto pelo URL quanto pelo prefixo do corpo (alguns firmwares variam).
    const kind = /^biophoto/i.test(body.trimStart()) ? "biophoto" : "userpic";
    debugDump(SN as string, `cdata-tabledata-${kind}`, body);
    const count = parseAndSavePhotos(SN as string, body, kind, `cdata-tabledata-${kind}`);
    res.set("Connection", "close");
    return res.type("text/plain").send(`${kind}=${count}\n`);
  } else {
    debugDump(SN as string, `cdata-unknown-${t}`, body);
    console.log(`[ZK] cdata POST unknown table: ${t}, body: ${body?.slice(0, 200)}`);
  }

  res.type("text/plain").send("OK");
});

// 2b. Query Data — device responds to DATA QUERY commands (photos, users, transactions)
app.post("/iclock/querydata", (req, res) => {
  const { SN, tablename } = req.query;
  const body = req.body as string;
  const ct = req.headers["content-type"] || "";
  const cl = req.headers["content-length"] || "";
  console.log(`[ZK] querydata from SN: ${SN}, tablename: ${tablename}, url=${req.originalUrl}, CT=${ct}, CL=${cl}, bodyLen=${body?.length ?? 0}`);
  if (SN) updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  debugDump(SN as string, `querydata-${tablename}`, `[CT=${ct}][CL=${cl}][URL=${req.originalUrl}]\n${body || "<empty>"}`);

  if (tablename === "user") {
    parseAndSaveUsers(SN as string, body, "querydata-user");
  } else if (tablename === "userpic" || tablename === "biophoto") {
    parseAndSavePhotos(SN as string, body, tablename as string, `querydata-${tablename}`);
  } else if (tablename === "transaction") {
    const lines = body.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const data: any = {};
      line.split(/\s(?=\w+=)/).forEach((part) => {
        const eq = part.indexOf("=");
        if (eq > -1) data[part.slice(0, eq)] = part.slice(eq + 1);
      });
      if (!data.pin) continue;
      db.prepare("INSERT INTO logs (sn, pin, time, status, verify_type) VALUES (?, ?, ?, ?, ?)")
        .run(SN as string, data.pin, data.time || "", data.status || 0, data.verify || 0);
      broadcast({ type: "new_log", log: { sn: SN, ...data } });
    }
  } else {
    console.log(`[ZK] querydata unknown tablename: ${tablename}`);
  }

  res.type("text/plain").send("OK");
});

function parseAndSaveUsers(sn: string, body: string, source: string) {
  const lines = body.split("\n");
  let count = 0;
  for (const line of lines) {
    if (!line.trim()) continue;

    // Support both formats:
    // "pin=1001 name=John privilege=0 cardno=123" (querydata)
    // "PIN=1001\tName=John\tPri=0\tPasswd=\tCard=" (USERINFO)
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
      db.prepare("INSERT OR REPLACE INTO users (pin, name, privilege, password, card) VALUES (?, ?, ?, ?, ?)")
        .run(pin, name, privilege, password, card);
      count++;
    }
  }
  console.log(`[ZK] ${source}: saved ${count} users from SN=${sn}`);
  const users = db.prepare("SELECT * FROM users").all();
  broadcast({ type: "users_updated", users });
}

function parseAndSavePhotos(sn: string, body: string, kind: string, source: string): number {
  // Per Push Protocol §7.8/§7.10/§9.6.1, a record is shaped like:
  //   "userpic\tpin=1\tfilename=1.jpg\tsize=22320\tcontent=<base64-jpeg>"
  // OR (per §9.6.1 example) split across lines:
  //   "biophoto pin=123\tfilename=123.jpg\ttype=9\tsize=95040\ncontent=AAAA..."
  // We split on the prefix boundary (not on '\n') so multi-line records stay whole.
  const records = body.split(/(?=^(?:userpic|biophoto)\s)/m).map(r => r.trim()).filter(Boolean);
  let saved = 0;
  for (const rec of records) {
    const stripped = rec.replace(/^(userpic|biophoto)\s+/, "");
    // Fields may be TAB-separated and content= often follows a newline. Normalize
    // both \n and \t into a single delimiter so split() yields all key=value pairs.
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
      // biophoto can carry binary face templates (Type=2) that aren't viewable images.
      console.log(`[ZK] ${source} pin=${pin}: not an image (likely template), skipping`);
      continue;
    }

    const filename = `${pin}.${isPng ? "png" : "jpg"}`;
    const fullPath = path.join(PHOTOS_DIR, filename);
    // Skip writing if same bytes already on disk — avoids retry-loop log spam.
    let same = false;
    try {
      if (fs.existsSync(fullPath)) {
        const existing = fs.readFileSync(fullPath);
        same = existing.length === buf.length && existing.equals(buf);
      }
    } catch {}
    if (!same) {
      fs.writeFileSync(fullPath, buf);
      db.prepare("INSERT OR IGNORE INTO users (pin) VALUES (?)").run(pin);
      db.prepare("UPDATE users SET photo_path = ? WHERE pin = ?").run(filename, pin);
    }
    console.log(`[ZK]   pin=${pin} ${same ? "(unchanged)" : "saved"} ${buf.length}B → ${filename}`);
    saved++;
  }
  console.log(`[ZK] ${source}: ${saved} photos from SN=${sn} (body ${body.length}B, ${records.length} records)`);
  if (saved === 0 && body.length > 0) {
    fs.appendFileSync(DEBUG_LOG, `\n[parseAndSavePhotos ${source}] 0 photos parsed. Body preview: ${body.slice(0, 400)}\n`);
  }
  if (saved > 0) {
    const users = db.prepare("SELECT * FROM users").all();
    broadcast({ type: "users_updated", users });
  }
  return saved;
}

// 3. Command Polling
app.get("/iclock/getrequest", (req, res) => {
  const { SN } = req.query;
  if (SN) updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  const command = db.prepare("SELECT * FROM commands WHERE sn = ? AND status = 0 ORDER BY id ASC LIMIT 1")
    .get(SN as string) as any;

  if (command) {
    db.prepare("UPDATE commands SET status = 1 WHERE id = ?").run(command.id);
    res.type("text/plain").send(`C:${command.id}:${command.command}\r\n`);
  } else {
    res.type("text/plain").send("OK");
  }
});

// 4. Command Result
app.post("/iclock/devicecmd", (req, res) => {
  const { SN } = req.query;
  const body = req.body as string;
  console.log(`[ZK] devicecmd from SN: ${SN}, body: ${body}`);
  if (SN) updateDeviceSeen(SN as string, (req.headers["x-forwarded-for"] as string) || req.ip || "", req);

  const match = body.match(/ID=(\d+)&Return=(-?\d+)/);
  if (match) {
    const id = match[1];
    const ret = parseInt(match[2]);
    db.prepare("UPDATE commands SET status = ? WHERE id = ?").run(ret === 0 ? 2 : 3, id);
    broadcast({ type: "command_result", id, success: ret === 0 });
  }

  res.type("text/plain").send("OK");
});

// --- API for Frontend ---

app.get("/api/config", (_req, res) => {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
  res.json({ port });
});

app.get("/api/devices", (_req, res) => {
  const devices = db.prepare("SELECT * FROM devices").all();
  const threshold = 5 * 60 * 1000;
  const now = Date.now();
  const result = (devices as any[]).map((d) => ({
    ...d,
    online: d.last_seen ? now - new Date(d.last_seen).getTime() < threshold : false,
  }));
  res.json(result);
});

app.get("/api/users", (_req, res) => {
  const users = db.prepare("SELECT * FROM users").all() as any[];
  res.json(users.map(u => {
    if (!u.photo_path) return u;
    try {
      const v = Math.floor(fs.statSync(path.join(PHOTOS_DIR, u.photo_path)).mtimeMs);
      return { ...u, photo_url: `/photos/${u.photo_path}?v=${v}` };
    } catch {
      return { ...u, photo_path: null };
    }
  }));
});

app.post("/api/users", express.json(), (req, res) => {
  const { pin, name, privilege, password, card } = req.body;
  try {
    db.prepare("INSERT INTO users (pin, name, privilege, password, card) VALUES (?, ?, ?, ?, ?)")
      .run(pin, name, privilege || 0, password || "", card || "");

    const devices = db.prepare("SELECT sn FROM devices").all() as any[];
    for (const dev of devices) {
      const cmd = `DATA UPDATE user Pin=${pin}\tName=${name}\tPrivilege=${privilege || 0}\tPassword=${password || ""}\tCardNo=${card || ""}\r\n`;
      db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(dev.sn, cmd.trim());
      const authCmd = `DATA UPDATE userauthorize Pin=${pin}\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1\r\n`;
      db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(dev.sn, authCmd.trim());
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/users/:pin", (req, res) => {
  const { pin } = req.params;
  db.prepare("DELETE FROM users WHERE pin = ?").run(pin);

  const devices = db.prepare("SELECT sn FROM devices").all() as any[];
  for (const dev of devices) {
    const cmd = `DATA DELETE user Pin=${pin}`;
    db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(dev.sn, cmd);
  }

  res.json({ success: true });
});

app.get("/api/logs", (_req, res) => {
  const logs = db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 100").all();
  res.json(logs);
});

app.post("/api/sync-users", (_req, res) => {
  const devices = db.prepare("SELECT sn FROM devices").all() as any[];
  if (devices.length === 0) {
    return res.status(400).json({ error: "Nenhum dispositivo conectado para sincronizar." });
  }

  for (const dev of devices) {
    db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(dev.sn, "DATA QUERY tablename=user,fielddesc=*,filter=*");
    // Note: this firmware (VDE...) doesn't support pull via DATA QUERY for biophoto/userpic
    // (always responds count=0&packcnt=0). Photos arrive only via push when edited on device.
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

startServer();
