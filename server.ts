import express from "express";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import Database from "better-sqlite3";
import path from "path";
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
    group_id INTEGER DEFAULT 1
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.text({ type: "*/*", limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function updateDeviceSeen(sn: string, ip: string) {
  const now = new Date().toISOString();
  const exists = db.prepare("SELECT sn FROM devices WHERE sn = ?").get(sn);
  if (exists) {
    db.prepare("UPDATE devices SET last_seen = ?, ip = ? WHERE sn = ?").run(now, ip, sn);
  } else {
    db.prepare("INSERT INTO devices (sn, alias, last_seen, ip) VALUES (?, ?, ?, ?)").run(sn, sn, now, ip);
  }
  broadcast({ type: "device_update", sn, last_seen: now, online: true });
}

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
    updateDeviceSeen(SN as string, ip);
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
  updateDeviceSeen(SN as string, ip);

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
    updateDeviceSeen(SN as string, ip);
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
    updateDeviceSeen(SN as string, ip);

    if (device) {
      return res.type("text/plain").send(
        `registry=ok\nRegistryCode=REG_${SN}_xyz789\nServerVersion=3.1.2\nPushProtVer=3.1.2\nRequestDelay=30\nTransTimes=00:00;14:00\nTransInterval=1\nRealtime=1`
      );
    }
  }

  res.type("text/plain").send("OK");
});

// 2. Data Upload — real-time logs and tabledata (POST cdata)
app.post("/iclock/cdata", (req, res) => {
  const { SN, table, Stamp } = req.query;
  const body = req.body as string;
  console.log(`[ZK] cdata POST from SN: ${SN}, table: ${table}, stamp: ${Stamp}`);

  if (table === "rtlog" || table === "ATTLOG") {
    // rtlog format: "pin=1001 time=2024-04-25 10:30:45 ..."
    // ATTLOG format: "PIN\tTIME\tSTATUS\tVERIFY_TYPE"
    const lines = body.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;

      let pin: string, time: string, status: string, verifyType: string;

      if (table === "rtlog") {
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
      db.prepare("INSERT INTO logs (sn, pin, time, status, verify_type) VALUES (?, ?, ?, ?, ?)")
        .run(SN as string, pin, time, status || 0, verifyType || 0);
      broadcast({ type: "new_log", log: { sn: SN, pin, time, status, verifyType } });
    }
  } else if (table === "OPERLOG") {
    console.log(`[ZK] OperLog from ${SN}: ${body}`);
  } else if (table === "USERINFO") {
    // Legacy: some devices still send USERINFO via cdata POST
    parseAndSaveUsers(SN as string, body, "cdata-USERINFO");
  } else {
    console.log(`[ZK] cdata POST unknown table: ${table}, body: ${body?.slice(0, 200)}`);
  }

  res.type("text/plain").send("OK");
});

// 2b. Query Data — device responds to DATA QUERY commands (photos, users, transactions)
app.post("/iclock/querydata", (req, res) => {
  const { SN, tablename } = req.query;
  const body = req.body as string;
  console.log(`[ZK] querydata from SN: ${SN}, tablename: ${tablename}`);

  if (tablename === "user") {
    parseAndSaveUsers(SN as string, body, "querydata-user");
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

// 3. Command Polling
app.get("/iclock/getrequest", (req, res) => {
  const { SN } = req.query;

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
  const users = db.prepare("SELECT * FROM users").all();
  res.json(users);
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
