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

// Initialize Database
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

// WebSocket Broadcast
function broadcast(data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// --- ZKTeco ADMS Endpoints ---

// 0. Handshake / Registry
app.post("/iclock/registry", (req, res) => {
  const { SN } = req.query;
  console.log(`[ZK] Registry from SN: ${SN}`);
  res.send("RegistryCode=1\nServerInternal=30\nPushVersion=3.0.1\n");
});

// 1. Initialization and Polling
app.get("/iclock/cdata", (req, res) => {
  const { SN, options } = req.query;
  console.log(`[ZK] cdata GET from SN: ${SN}, options: ${options}`);
  
  if (SN) {
    db.prepare("INSERT OR REPLACE INTO devices (sn, last_seen, ip) VALUES (?, ?, ?)")
      .run(SN as string, new Date().toISOString(), req.headers['x-forwarded-for'] || req.ip);
    broadcast({ type: "device_update", sn: SN });
  }

  // Return server settings to the device
  res.send("GET OPTION FROM: " + SN + "\n" +
           "Stamp=0\n" +
           "OpStamp=0\n" +
           "PhotoStamp=0\n" +
           "ErrorDelay=30\n" +
           "Delay=30\n" +
           "TransTimes=00:00;14:00\n" +
           "TransInterval=1\n" +
           "TransFlag=1111000000\n" +
           "Realtime=1\n" +
           "Encrypt=0");
});

// 2. Data Upload (Logs, Users, etc.)
app.post("/iclock/cdata", (req, res) => {
  const { SN, table, Stamp } = req.query;
  const body = req.body as string;
  console.log(`[ZK] cdata POST from SN: ${SN}, table: ${table}, stamp: ${Stamp}`);

  if (table === "ATTLOG") {
    const lines = body.split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      // Format: PIN \t TIME \t STATUS \t VERIFY_TYPE
      if (parts.length >= 2) {
        const [pin, time, status, verifyType] = parts;
        db.prepare("INSERT INTO logs (sn, pin, time, status, verify_type) VALUES (?, ?, ?, ?, ?)")
          .run(SN as string, pin, time, status || 0, verifyType || 0);
        
        broadcast({ 
          type: "new_log", 
          log: { sn: SN, pin, time, status, verifyType } 
        });
      }
    }
  } else if (table === "OPERLOG") {
    console.log(`[ZK] Operation Log from ${SN}: ${body}`);
  }

  res.send("OK");
});

// 3. Command Polling
app.get("/iclock/getrequest", (req, res) => {
  const { SN } = req.query;
  // console.log(`[ZK] getrequest from SN: ${SN}`);

  const command = db.prepare("SELECT * FROM commands WHERE sn = ? AND status = 0 ORDER BY id ASC LIMIT 1")
    .get(SN as string) as any;

  if (command) {
    db.prepare("UPDATE commands SET status = 1 WHERE id = ?").run(command.id);
    res.send(`C:${command.id}:${command.command}`);
  } else {
    res.send("OK");
  }
});

// 4. Command Result
app.post("/iclock/devicecmd", (req, res) => {
  const { SN } = req.query;
  const body = req.body as string;
  console.log(`[ZK] devicecmd from SN: ${SN}, body: ${body}`);

  // Body format: ID=1&Return=0
  const match = body.match(/ID=(\d+)&Return=(-?\d+)/);
  if (match) {
    const id = match[1];
    const ret = parseInt(match[2]);
    db.prepare("UPDATE commands SET status = ? WHERE id = ?")
      .run(ret === 0 ? 2 : 3, id);
    
    broadcast({ type: "command_result", id, success: ret === 0 });
  }

  res.send("OK");
});

// --- API for Frontend ---

app.get("/api/devices", (req, res) => {
  const devices = db.prepare("SELECT * FROM devices").all();
  res.json(devices);
});

app.get("/api/users", (req, res) => {
  const users = db.prepare("SELECT * FROM users").all();
  res.json(users);
});

app.post("/api/users", express.json(), (req, res) => {
  const { pin, name, privilege, password, card } = req.body;
  try {
    db.prepare("INSERT INTO users (pin, name, privilege, password, card) VALUES (?, ?, ?, ?, ?)")
      .run(pin, name, privilege || 0, password || "", card || "");
    
    // Queue command for all devices
    const devices = db.prepare("SELECT sn FROM devices").all() as any[];
    for (const dev of devices) {
      const cmd = `DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPri=${privilege || 0}\tPasswd=${password || ""}\tCard=${card || ""}`;
      db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(dev.sn, cmd);
    }

    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/users/:pin", (req, res) => {
  const { pin } = req.params;
  db.prepare("DELETE FROM users WHERE pin = ?").run(pin);
  
  // Queue delete command
  const devices = db.prepare("SELECT sn FROM devices").all() as any[];
  for (const dev of devices) {
    const cmd = `DATA DELETE USERINFO PIN=${pin}`;
    db.prepare("INSERT INTO commands (sn, command) VALUES (?, ?)").run(dev.sn, cmd);
  }
  
  res.json({ success: true });
});

app.get("/api/logs", (req, res) => {
  const logs = db.prepare("SELECT * FROM logs ORDER BY id DESC LIMIT 100").all();
  res.json(logs);
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
