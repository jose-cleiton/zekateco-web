/**
 * Cliente HTTP pra API do Soltech, autenticado via Keycloak (client_credentials).
 *
 * Fluxo de comandos (webdriver mode):
 *   1. Backend enfileira commands (op_id na faixa 5000-5999)
 *   2. Chama sendRepCommand(sn, "REBOOT", op_id) → POST /rep/zkteco/send-command/:sn
 *   3. Soltech enfileira internamente e entrega no próximo poll do relógio
 *   4. Relógio executa, retorna via /iclock/devicecmd → passa pela cópia
 *      espelhada → nosso middleware /__mirror/ correlaciona por op_id
 *
 * Pré-requisitos (fora do escopo dessa lib, feito pelo time do Soltech):
 *   - Client Keycloak `zekateco-web` no realm `Ultraponto` (client_credentials)
 *   - Role `rep-command` atribuída ao service account do client
 *   - Endpoint POST /rep/zkteco/send-command/:sn com @Roles aceita rep-command
 */

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "";
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || "Ultraponto";
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || "zekateco-web";
const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || "";
const SOLTECH_API_URL = (process.env.SOLTECH_API_URL || "").replace(/\/$/, "");

const TOKEN_MARGIN_MS = 30_000; // renova 30s antes de expirar
const REQUEST_TIMEOUT_MS = parseInt(process.env.SOLTECH_TIMEOUT_MS || "10000");

let cachedToken: { access_token: string; expires_at: number } | null = null;
let tokenInflight: Promise<string> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function fetchToken(): Promise<string> {
  if (!KEYCLOAK_URL || !KEYCLOAK_CLIENT_SECRET) {
    throw new Error("Keycloak não configurado (KEYCLOAK_URL/CLIENT_SECRET ausentes)");
  }
  const url = `${KEYCLOAK_URL.replace(/\/$/, "")}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: KEYCLOAK_CLIENT_ID,
    client_secret: KEYCLOAK_CLIENT_SECRET,
  });
  const res = await withTimeout(
    fetch(url, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
    REQUEST_TIMEOUT_MS,
    "keycloak token",
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Keycloak token HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000 - TOKEN_MARGIN_MS,
  };
  return data.access_token;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) return cachedToken.access_token;
  if (tokenInflight) return tokenInflight; // dedup: várias requests concorrentes usam mesmo fetch
  tokenInflight = fetchToken().finally(() => { tokenInflight = null; });
  return tokenInflight;
}

export function isSoltechClientConfigured(): boolean {
  return !!(KEYCLOAK_URL && KEYCLOAK_CLIENT_SECRET && SOLTECH_API_URL);
}

/**
 * Envia comando ao REP via API do Soltech.
 * @param sn — número de série do REP
 * @param command — comando ADMS (ex: "REBOOT", "DATA QUERY tablename=user,filter=*")
 * @param opId — ID do comando (obrigatório entre 5000-5999 pra evitar colisão com Soltech)
 * @returns opId enviado (mesmo que passou)
 * @throws se Soltech responder erro ou timeout
 */
export async function sendRepCommand(sn: string, command: string, opId: number): Promise<{ opId: number }> {
  if (!isSoltechClientConfigured()) {
    throw new Error("Cliente Soltech não configurado — variáveis KEYCLOAK_URL/SECRET/SOLTECH_API_URL ausentes");
  }
  if (opId < 5000 || opId > 5999) {
    throw new Error(`opId ${opId} fora da faixa reservada 5000-5999`);
  }
  const token = await getToken();
  const url = `${SOLTECH_API_URL}/rep/zkteco/send-command/${encodeURIComponent(sn)}`;
  // Formato do Soltech: C:<ID>:<CMD>\r\n (o \r\n é obrigatório no protocolo ADMS)
  const commandStr = `C:${opId}:${command}\r\n`;
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ command: commandStr }),
    }),
    REQUEST_TIMEOUT_MS,
    "soltech send-command",
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 401 = token expirou (raro, temos margin). Invalida cache pra próxima
    // tentativa ir buscar novo token.
    if (res.status === 401) cachedToken = null;
    throw new Error(`Soltech send-command HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return { opId };
}

/**
 * Aloca próximo op_id na faixa 5000-5999. Roda em cycle (depois de 5999, volta pra 5000).
 *
 * O contador precisa ser inicializado com base no MAX(op_id) do DB pra evitar
 * colisão após restart do backend. Use `initOpIdCounter(startFrom)` antes do
 * primeiro allocateOpId (chamado no server.ts após conectar no DB).
 */
let nextOpIdCounter = 5000;
export function initOpIdCounter(startFrom: number): void {
  // Se o último op_id usado foi 5100, próximo é 5101. Se foi >= 5999, faz cycle.
  const next = startFrom >= 5999 ? 5000 : startFrom + 1;
  nextOpIdCounter = Math.max(5000, Math.min(5999, next));
}

export function allocateOpId(): number {
  const id = nextOpIdCounter;
  nextOpIdCounter = nextOpIdCounter >= 5999 ? 5000 : nextOpIdCounter + 1;
  return id;
}

/** Reseta contador — só usar em testes. */
export function _resetOpIdCounter(v = 5000): void {
  nextOpIdCounter = v;
}
