# Protocolo de Sincronização de Usuários — Dashboard ↔ REP ZKTeco

**Versão:** 1.0  
**Referência:** Security PUSH Communication Protocol (ADMS v3.x)  
**Protocolo de transporte:** HTTP/1.1 texto puro — sem JSON entre servidor e REP

---

## 1. Visão Geral

A sincronização de usuários é **bidirecional**:

- **Dashboard → Banco → REP:** o usuário cria, edita ou exclui um cadastro no dashboard. O servidor persiste no banco e enfileira comandos ADMS para o REP.
- **REP → Banco → Dashboard:** o REP empurra sua lista de usuários ao servidor (em resposta a um `DATA QUERY` ou em push automático). O servidor persiste e notifica o dashboard via WebSocket.

O banco SQLite é a fonte de verdade. Em conflito, a operação mais recente prevalece (Last-Write-Wins por `updated_at`).

```
Dashboard (REST)
    │
    ▼ persiste
  SQLite ──► user_ops (fila + log)
    │              │
    ▼              ▼ via GET /iclock/getrequest
  Broadcast    Comando ADMS entregue ao REP
  WebSocket        │
    ▲              ▼ via POST /iclock/devicecmd
    └──── ack (Return=N) atualiza user_ops
```

---

## 2. Limitações do Protocolo ADMS

| Capacidade | Suporte no firmware VDE2252800062 |
|---|---|
| Criar/atualizar usuário no REP | ✅ `DATA UPDATE user` |
| Autorizar acesso | ✅ `DATA UPDATE userauthorize` |
| Excluir usuário do REP | ✅ `DATA DELETE user` |
| Consultar usuários do REP | ✅ `DATA QUERY tablename=user` |
| REP empurra usuários ao servidor | ✅ `POST /iclock/querydata?tablename=user` |
| JSON nos comandos | ❌ Protocolo é texto puro, campos separados por `\t` |
| Resposta detalhada do REP | ❌ Apenas `Return=N` (≥0 sucesso, <0 erro) |
| Campo `version` monotônico | ❌ REP não conhece versão; controle apenas no servidor |

---

## 3. Schema do Banco de Dados

### 3.1 Tabela `users`

```sql
CREATE TABLE IF NOT EXISTS users (
  pin          TEXT PRIMARY KEY,   -- ID do usuário no REP (numérico como texto)
  name         TEXT,
  privilege    INTEGER DEFAULT 0,  -- 0 = comum, 14 = administrador
  password     TEXT DEFAULT '',
  card         TEXT DEFAULT '',    -- número do cartão RFID
  photo_path   TEXT,
  photo_blob   BLOB,
  photo_hash   TEXT,
  photo_synced_at TEXT,
  group_id     INTEGER DEFAULT 1
);
```

### 3.2 Tabela `user_ops` (fila + log de operações)

```sql
CREATE TABLE IF NOT EXISTS user_ops (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id  TEXT UNIQUE NOT NULL,  -- "pop_<epoch_ms>_<6rand>"
  sn            TEXT NOT NULL,          -- SN do REP alvo
  pin           TEXT NOT NULL,
  op_type       TEXT NOT NULL CHECK(op_type IN ('upsert','delete')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','sent','success','error','critical')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,                   -- ISO-8601; NULL = imediato
  command_id    INTEGER,                -- FK para commands.id (último comando)
  error_detail  TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);
```

### 3.3 Tabela `commands` (fila genérica de comandos ADMS)

```sql
CREATE TABLE IF NOT EXISTS commands (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sn         TEXT NOT NULL,
  command    TEXT NOT NULL,
  status     INTEGER DEFAULT 0,  -- 0 pending | 1 sent | 2 success | 3 error
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

---

## 4. Comandos ADMS — Servidor → REP

Os comandos são entregues via resposta do `GET /iclock/getrequest`:

```
C:<command_id>:<COMMAND_TEXT>\r\n
```

O REP confirma via `POST /iclock/devicecmd`:

```
ID=<command_id>&Return=<N>&CMD=<COMMAND_TEXT>
```

### 4.1 Criar ou atualizar usuário

Dois comandos sempre enfileirados em sequência:

**Comando 1 — dados do usuário:**

```
DATA UPDATE user Pin=<pin>\tName=<name>\tPrivilege=<0|14>\tPassword=<pwd>\tCardNo=<card>
```

**Comando 2 — autorização de acesso:**

```
DATA UPDATE userauthorize Pin=<pin>\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1
```

O `user_ops` rastreia o `command_id` do segundo comando (userauthorize), que confirma o ciclo completo.

### 4.2 Excluir usuário

```
DATA DELETE user Pin=<pin>
```

### 4.3 Consultar todos os usuários do REP (pull)

```
DATA QUERY tablename=user,fielddesc=*,filter=*
```

O REP responde com `POST /iclock/querydata?tablename=user` contendo os registros em texto.

### 4.4 Interpretação do Return code

| Return | Significado |
|---|---|
| `Return=N` (N >= 0) | Sucesso — N registros processados |
| `Return=-1` | Comando não suportado (crítico, sem retry) |
| `Return=-2` | PIN não encontrado; em delete = sucesso (idempotente) |
| Outros negativos | Erro de execução — retry com backoff |

---

## 5. Fluxo Dashboard → REP

```
1. POST /api/users  (JSON, dashboard → servidor)
   body: { pin, name, privilege, password, card }

2. Servidor:
   a. INSERT INTO users (pin, name, privilege, password, card)
   b. Para cada REP conectado:
      - INSERT INTO commands: DATA UPDATE user ...
      - INSERT INTO commands: DATA UPDATE userauthorize ...
      - INSERT INTO user_ops: status='pending', command_id=<id do userauthorize>
   c. broadcast({ type: "users_updated" }) → dashboard recarrega lista

3. REP faz polling GET /iclock/getrequest
   → Servidor entrega C:<id>:DATA UPDATE user ...
   → Servidor atualiza user_ops.status = 'sent', broadcast user_op_update

4. REP executa e responde POST /iclock/devicecmd
   ID=<id>&Return=1&CMD=DATA UPDATE userauthorize ...
   → Servidor marca user_ops.status = 'success'
   → broadcast({ type: "user_op_update", status: "success", pin })
   → Dashboard remove badge de status
```

---

## 6. Fluxo REP → Dashboard (push de usuários)

O REP empurra sua lista de usuários em dois momentos:

**Resposta a `DATA QUERY`:** servidor enfileira o comando (ex: ao registrar novo REP), REP responde via `POST /iclock/querydata?tablename=user`.

**Push automático via cdata:** alguns firmwares enviam `POST /iclock/cdata?table=USERINFO` em tempo real ao cadastrar usuário no REP.

### Formato do body recebido do REP

Cada linha é um registro (dois formatos possíveis):

Formato espaçado (querydata):

```
pin=1001 name=João Silva privilege=0 cardno=12345678
pin=1002 name=Maria privilege=14 cardno=
```

Formato com TABs (USERINFO):

```
PIN=1001\tName=João Silva\tPri=0\tPasswd=\tCard=12345678
```

### Processamento no servidor

```sql
INSERT INTO users (pin, name, privilege, password, card) VALUES (?, ?, ?, ?, ?)
ON CONFLICT(pin) DO UPDATE SET
  name      = excluded.name,
  privilege = excluded.privilege,
  password  = excluded.password,
  card      = excluded.card
-- photo_path e photo_blob NAO sao tocados (fonte de verdade é o servidor)
```

Após salvar: `broadcast({ type: "users_updated" })` → dashboard recarrega.

---

## 7. Exemplos HTTP — Dashboard → Servidor

### 7.1 Criar usuário

```bash
curl -X POST http://192.168.1.78:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"pin":"1001","name":"Joao Silva","privilege":0,"password":"","card":"12345678"}'
```

Resposta:

```json
{ "success": true }
```

### 7.2 Excluir usuário

```bash
curl -X DELETE http://192.168.1.78:3000/api/users/1001
```

Resposta:

```json
{ "success": true }
```

### 7.3 Forçar pull do REP para o banco

```bash
curl -X POST http://192.168.1.78:3000/api/sync-users
```

Resposta:

```json
{ "success": true, "message": "Comando de sincronização enviado para todos os dispositivos." }
```

---

## 8. Sequência ADMS na rede (exemplo real)

```
Servidor                              REP
   │                                   │
   │  <- GET /iclock/getrequest        │
   │  -> C:42:DATA UPDATE user Pin=1001\tName=Joao\tPrivilege=0\tPassword=\tCardNo=
   │                                   │
   │  <- GET /iclock/getrequest        │
   │  -> C:43:DATA UPDATE userauthorize Pin=1001\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1
   │                                   │
   │  <- POST /iclock/devicecmd        │
   │     ID=42&Return=1&CMD=DATA UPDATE user
   │                                   │
   │  <- POST /iclock/devicecmd        │
   │     ID=43&Return=1&CMD=DATA UPDATE userauthorize
   │                                   │
   │  user_ops.status = 'success'      │
   │  broadcast user_op_update         │
```

---

## 9. Política de Retry e Tolerância a Falhas

### 9.1 Backoff exponencial

```
tentativa 1: imediato
tentativa 2: +30s
tentativa 3: +60s
tentativa 4: +120s
tentativa 5: +300s
apos 5 falhas: status = 'critical' — para de retentar
```

### 9.2 Comportamento por Return code

| Situação | Ação |
|---|---|
| `Return >= 0` | Sucesso — marca `status='success'` |
| `Return=-2` em delete | Sucesso (PIN ja nao existia — idempotente) |
| `Return=-2` em upsert | Retry imediato (PIN nao encontrado — reenvia) |
| `Return=-1` | Critico — sem retry; notifica dashboard |
| Outros negativos | Retry com backoff |
| Socket fechado antes do ack | Comandos `status=1` voltam para `status=0`; `user_ops` volta para `pending` |

### 9.3 Reset ao desconectar

Quando o idle reaper detecta socket inativo (> 60s) e destrói a conexão:

```sql
UPDATE commands SET status=0 WHERE sn=? AND status=1;
UPDATE user_ops  SET status='pending', next_retry_at=NULL WHERE sn=? AND status='sent';
```

Garante que comandos entregues mas sem ack sejam reenviados na próxima conexão.

---

## 10. Resolução de Conflitos

Como o REP não envia `version` nem `timestamp` nos registros de usuário:

**Dashboard como autoridade:** alterações feitas no dashboard sempre enfileiram um `DATA UPDATE` para o REP. Se o REP tiver versão diferente, é sobrescrito.

**REP como fonte de leitura:** o pull via `DATA QUERY` atualiza apenas `name`, `privilege`, `password`, `card` — nunca `photo_path` nem `photo_blob`.

**Edição simultânea:** sem mecanismo de lock distribuído. A última operação a chegar ao banco vence (LWW por `updated_at` do SQLite).

---

## 11. Observabilidade

### 11.1 Status visual no dashboard

| Badge | Status interno | Significado |
|---|---|---|
| Ambar girando "enviando" | `pending` ou `sent` | Aguardando REP executar |
| Laranja "retry" | `error` | Falha transitoria, reenviando |
| Vermelho "falhou" | `critical` | Maximo de tentativas atingido |
| Sem badge | `success` | Sincronizado |

### 11.2 Transições de status via WebSocket

O servidor emite `user_op_update` a cada transição:

```
pending  → sent     (getrequest entregou o comando ao REP)
sent     → success  (devicecmd Return>=0)
sent     → error    (devicecmd Return<0, tentativas restantes)
error    → pending  (retry loop reenfileirou)
qualquer → critical (tentativas esgotadas ou Return=-1)
```

### 11.3 Endpoints de diagnóstico

```bash
# Listar ops de um usuário
GET /api/photo-ops?pin=1001

# Reenviar manualmente uma op critica
POST /api/photo-ops/<operation_id>/retry

# Metricas gerais
GET /api/photo-ops/metrics
```

---

## 12. Reconciliação Periódica

**Ao reconectar (automático):** comandos `sent` sem ack voltam para `pending` e são reenviados imediatamente.

**Manual via dashboard:** botão "Sincronizar do REP" chama `POST /api/sync-users` — enfileira `DATA QUERY tablename=user` para todos os REPs e atualiza o banco com o estado atual.

**Reconciliação completa (opcional):** após o pull, comparar `users` do banco com os recebidos do REP e enfileirar `DATA UPDATE` para usuários que existem no banco mas não vieram no pull.

---

## 13. Mapeamento de Requisitos x Realidade ADMS

| Requisito | Implementacao |
|---|---|
| `operation_id` unico | `user_ops.operation_id` (`pop_<ts>_<rand>`) |
| Retry com backoff | `user_ops.next_retry_at` + `setInterval` 60s |
| Idempotencia em delete | `Return=-2` tratado como sucesso |
| Versao monotonica | REP nao suporta; LWW por `updated_at` no banco |
| `expected_version` em delete | ADMS nao suporta; DELETE sempre remove sem condicao |
| JSON nos comandos | Protocolo ADMS e texto puro com `\t` |
| Autenticacao por token | REP autentica por `RegistryCode` do handshake |
| Feedback em tempo real | WebSocket broadcast em cada transicao de status |
| Reset ao desconectar | Idle reaper reseta `status=1 -> 0` |

---

*Documento gerado em 2026-04-26. Atualizar se o firmware ou modelo do REP mudar.*
