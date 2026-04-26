# Protocolo de Sincronização de Fotos — Dashboard → REP ZKTeco

**Versão:** 1.0  
**Referência de protocolo:** Security PUSH Communication Protocol (ADMS v3.x)  
**Restrição crítica:** o firmware VDE2252800062 **não permite download (pull) de fotos**; o servidor age como única fonte de verdade e envia toda atualização via comando ADMS.

---

## 1. Visão Geral

O fluxo é estritamente unidirecional: **Dashboard → Banco → Servidor → REP**.  
O banco SQLite é a fonte de verdade. Qualquer operação de foto feita pelo usuário no dashboard primeiro persiste no banco e depois é entregue ao REP via fila de comandos ADMS.

```
Usuário (dashboard)
      │
      ▼ REST (JSON)
  Servidor Express
      │ persiste banco
      ▼
  SQLite (fonte de verdade)
      │ enfileira comando ADMS
      ▼
  Tabela `photo_ops` (fila + log)
      │ entregue via GET /iclock/getrequest
      ▼
  REP ZKTeco
      │ resultado via POST /iclock/devicecmd
      ▼
  Tabela `photo_ops` (status atualizado)
```

---

## 2. Limitações do Protocolo ADMS (ZKTeco)

Antes de qualquer especificação, é essencial entender o que o REP **realmente suporta**:

| Capacidade | Suporte no firmware VDE2252800062 |
|---|---|
| Receber foto (push do servidor) | ✅ `DATA UPDATE userpic` e `DATA UPDATE BIOPHOTO` |
| Apagar foto | ✅ `DATA DELETE userpic` e `DATA DELETE biophoto` |
| Confirmar operação | ✅ `POST /iclock/devicecmd` com `Return=N` (número inteiro) |
| JSON nos comandos | ❌ Protocolo é texto puro (campos separados por `\t`) |
| Validar SHA-256 | ❌ REP não valida hash; validação ocorre apenas no servidor |
| Resposta detalhada de status | ❌ Apenas `Return=N` (≥0 = sucesso, <0 = erro) |
| Download de fotos (pull) | ❌ Não implementado neste firmware |
| TLS/HTTPS | Depende da configuração de rede; o protocolo ADMS em si não exige |
| Autenticação por token | ❌ O REP autentica pelo `RegistryCode` negociado no handshake |

> **Consequência prática:** os payloads JSON descritos no contexto deste documento descrevem a interface **Dashboard → Servidor**. A interface **Servidor → REP** usa comandos ADMS text-based documentados na Seção 4.

---

## 3. Schema do Banco de Dados

### 3.1 Tabela `users` (existente — colunas relevantes)

```sql
CREATE TABLE IF NOT EXISTS users (
  pin         TEXT PRIMARY KEY,
  name        TEXT,
  privilege   INTEGER DEFAULT 0,
  password    TEXT,
  card        TEXT,
  photo_path  TEXT,        -- nome do arquivo em photos/<pin>.jpg
  photo_blob  BLOB,        -- bytes JPEG/PNG otimizados (≤20 KB)
  photo_hash  TEXT,        -- SHA-256 hex do photo_blob (novo)
  photo_synced_at DATETIME -- última vez que o REP confirmou a foto (novo)
);
```

### 3.2 Tabela `photo_ops` (nova — fila + log de operações)

```sql
CREATE TABLE IF NOT EXISTS photo_ops (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id  TEXT UNIQUE NOT NULL,  -- ex: "pop_<timestamp>_<random>"
  sn            TEXT NOT NULL,          -- SN do REP alvo
  pin           TEXT NOT NULL,
  op_type       TEXT NOT NULL CHECK(op_type IN ('upsert','delete')),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','sent','success','error','critical')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  next_retry_at DATETIME,
  command_id    INTEGER,               -- FK para commands.id (se já enfileirado)
  photo_hash    TEXT,                  -- hash no momento do enfileiramento
  error_detail  TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photo_ops_pending
  ON photo_ops(status, next_retry_at)
  WHERE status IN ('pending','error');
```

### 3.3 JSON Schema — corpo da requisição Dashboard → Servidor (upsert)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PhotoUpsertRequest",
  "type": "object",
  "required": ["photo"],
  "properties": {
    "photo": {
      "description": "Arquivo enviado via multipart/form-data (campo 'photo')",
      "type": "string",
      "format": "binary"
    }
  }
}
```

### 3.4 JSON Schema — resposta de status de operação

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PhotoOpStatus",
  "type": "object",
  "properties": {
    "operation_id": { "type": "string" },
    "pin":          { "type": "string" },
    "op_type":      { "type": "string", "enum": ["upsert","delete"] },
    "status":       { "type": "string", "enum": ["pending","sent","success","error","critical"] },
    "attempt_count":{ "type": "integer" },
    "photo_hash":   { "type": ["string","null"] },
    "error_detail": { "type": ["string","null"] },
    "created_at":   { "type": "string", "format": "date-time" },
    "updated_at":   { "type": "string", "format": "date-time" }
  }
}
```

---

## 4. Comandos ADMS (Servidor → REP)

Os comandos são entregues via resposta do `GET /iclock/getrequest` no formato:

```
C:<command_id>:<COMMAND_TEXT>\r\n
```

O REP executa e responde via `POST /iclock/devicecmd`:

```
ID=<command_id>&Return=<N>&CMD=<COMMAND_TEXT>
```

`Return` ≥ 0 = sucesso (N = registros processados). `Return` < 0 = erro (ver Appendix 1 do PDF).

### 4.1 Upsert de foto (criar ou substituir)

Dois comandos são sempre enfileirados em sequência para cada upsert:

**Comando 1 — biophoto (template biométrico + foto para reconhecimento facial):**

```
DATA UPDATE BIOPHOTO PIN=<pin>\tType=9\tNo=0\tIndex=0\tSize=<len_b64>\tContent=<base64_jpeg>\tFormat=0
```

**Comando 2 — userpic (avatar exibido no display do REP):**

```
DATA UPDATE userpic pin=<pin>\tsize=<len_b64>\tformat=0\tcontent=<base64_jpeg>
```

> `<len_b64>` = comprimento da string base64, não dos bytes da imagem.  
> A imagem deve estar em JPEG, ≤20 KB após otimização (dimensões 358×441 px, cover fit).

### 4.2 Delete de foto

**Comando 1 — biophoto:**

```
DATA DELETE biophoto PIN=<pin>\tType=9
```

**Comando 2 — userpic:**

```
DATA DELETE userpic pin=<pin>
```

### 4.3 Interpretação do Return code

| Return | Significado para operação de foto |
|---|---|
| `Return=0` | Sucesso sem alteração (já estava igual) |
| `Return=1` | Sucesso — 1 registro processado |
| `Return=-1` | Comando não suportado (firmware) |
| `Return=-2` | Usuário/PIN não encontrado no REP |
| Outros negativos | Erro de execução (ver Appendix 1 do PDF) |

> **Nota:** o REP não retorna `hash_mismatch`. A validação de integridade é responsabilidade exclusiva do servidor (ver Seção 6.3).

---

## 5. Fluxo Detalhado de Operações

### 5.1 Upload / Atualização de foto no dashboard

```
1. Usuário envia imagem via multipart/form-data
   POST /api/users/:pin/photo

2. Servidor valida:
   - content-type deve ser image/jpeg ou image/png
   - tamanho máximo: 5 MB (antes da otimização)
   - (opcional) dimensões mínimas: 100×100 px

3. Servidor otimiza a imagem:
   - Redimensiona para 358×441 px (cover, attention crop)
   - Comprime para JPEG qualidade decrescente até ≤20 KB

4. Servidor persiste no banco:
   UPDATE users SET
     photo_blob = <bytes>,
     photo_path = '<pin>.jpg',
     photo_hash = sha256(<bytes>),
     photo_synced_at = NULL
   WHERE pin = <pin>;

5. Servidor escreve em photo_ops:
   INSERT INTO photo_ops (operation_id, sn, pin, op_type, photo_hash)
   VALUES ('pop_<ts>_<rand>', '<sn>', '<pin>', 'upsert', '<hash>');
   -- uma linha por REP conectado

6. Servidor enfileira os 2 comandos ADMS em `commands`:
   DATA UPDATE BIOPHOTO ...
   DATA UPDATE userpic ...
   -- e atualiza photo_ops.command_id com o ID do último comando

7. REP faz polling GET /iclock/getrequest
   → recebe C:<id>:DATA UPDATE BIOPHOTO ...
   → recebe C:<id+1>:DATA UPDATE userpic ...

8. REP executa e responde POST /iclock/devicecmd
   ID=<id>&Return=1&CMD=DATA UPDATE BIOPHOTO
   ID=<id+1>&Return=1&CMD=DATA UPDATE userpic

9. Servidor processa devicecmd:
   - Return ≥ 0 → marca photo_ops.status = 'success',
     atualiza users.photo_synced_at = now()
   - Return < 0 → aciona política de retry (Seção 6)
```

### 5.2 Exclusão de foto no dashboard

```
1. Usuário clica em remover
   DELETE /api/users/:pin/photo

2. Servidor remove do banco:
   UPDATE users SET photo_blob = NULL, photo_path = NULL,
                    photo_hash = NULL, photo_synced_at = NULL
   WHERE pin = <pin>;
   (remove arquivo em photos/<pin>.jpg)

3. Servidor escreve em photo_ops (op_type='delete')

4. Servidor enfileira:
   DATA DELETE biophoto PIN=<pin>\tType=9
   DATA DELETE userpic pin=<pin>

5. REP responde via devicecmd
   - Return ≥ 0 ou Return=-2 (not_found) → ambos = sucesso
     (objetivo é garantir que a foto não existe no REP)
   - Outros Return negativos → retry
```

---

## 6. Política de Retry e Tolerância a Falhas

### 6.1 Classificação de erros

| Situação | Ação |
|---|---|
| Socket timeout / REP offline | Retry com backoff exponencial |
| `Return < 0` (genérico) | Retry com backoff exponencial |
| `Return=-1` (unsupported) | Não retenta; marca `status='critical'`; notifica |
| `Return=-2` em delete | Considera sucesso (idempotente) |
| `Return=-2` em upsert | Converte em create (reenfileira sem condição) |
| Falha de validação local (payload inválido) | Não retenta; erro imediato ao dashboard |

### 6.2 Backoff exponencial

```
tentativa 1: imediato (já enfileirado)
tentativa 2: +30s
tentativa 3: +60s
tentativa 4: +120s
tentativa 5: +300s
após 5 falhas: status = 'critical', para de retentar
```

`next_retry_at` é calculado e salvo em `photo_ops` após cada falha.

Um `setInterval` no servidor (ex: a cada 60s) verifica:

```sql
SELECT * FROM photo_ops
WHERE status IN ('pending','error')
  AND (next_retry_at IS NULL OR next_retry_at <= datetime('now'))
  AND attempt_count < max_attempts;
```

e reenfileira os comandos ADMS correspondentes.

### 6.3 Validação de integridade (substituto do hash_mismatch)

O REP não valida SHA-256. O servidor aplica a validação ao salvar no banco:

1. Ao receber upload: computa `sha256(photo_blob)` e salva em `users.photo_hash`.
2. Ao enfileirar comando: registra o hash em `photo_ops.photo_hash`.
3. Ao confirmar sucesso (Return ≥ 0): compara `photo_ops.photo_hash` com `users.photo_hash`.
   - Se divergirem (foto foi atualizada enquanto o comando estava em fila): reenfileira com o hash atual.

### 6.4 Idempotência

Cada operação tem um `operation_id` único (`pop_<epoch_ms>_<6chars_random>`). Se o servidor reiniciar com comandos pendentes, o retry loop retoma a partir de `photo_ops` sem duplicar operações porque a verificação é feita na tabela, não em memória.

---

## 7. Exemplos de Requests HTTP (Dashboard → Servidor)

### 7.1 Upload de foto

```bash
curl -X POST http://192.168.1.78:3000/api/users/1/photo \
  -F "photo=@/caminho/da/foto.jpg"
```

**Resposta de sucesso (200):**

```json
{
  "success": true,
  "size": 18432,
  "operation_id": "pop_1745676896000_a3f8b2"
}
```

**Resposta de erro de validação (400):**

```json
{
  "error": "Imagem muito grande após otimização (máx 20 KB)"
}
```

### 7.2 Exclusão de foto

```bash
curl -X DELETE http://192.168.1.78:3000/api/users/1/photo
```

**Resposta (200):**

```json
{
  "success": true,
  "operation_id": "pop_1745676900000_x9k1m4"
}
```

### 7.3 Status de sincronização de uma operação

```bash
curl http://192.168.1.78:3000/api/photo-ops/pop_1745676896000_a3f8b2
```

**Resposta:**

```json
{
  "operation_id": "pop_1745676896000_a3f8b2",
  "pin": "1",
  "op_type": "upsert",
  "status": "success",
  "attempt_count": 1,
  "photo_hash": "sha256:3a7bd3e2b3...",
  "error_detail": null,
  "created_at": "2026-04-26T12:34:56Z",
  "updated_at": "2026-04-26T12:35:02Z"
}
```

### 7.4 Reenvio manual de operação crítica

```bash
curl -X POST http://192.168.1.78:3000/api/photo-ops/pop_1745676896000_a3f8b2/retry
```

**Resposta:**

```json
{
  "success": true,
  "message": "Operação reenfileirada para retentativa"
}
```

### 7.5 Listagem de operações por usuário

```bash
curl "http://192.168.1.78:3000/api/photo-ops?pin=1&limit=10"
```

---

## 8. Observabilidade

### 8.1 Métricas expostas via `/api/photo-ops/metrics`

```json
{
  "total_sent": 42,
  "total_success": 39,
  "total_error": 2,
  "total_critical": 1,
  "avg_attempts": 1.08,
  "pending_ops": 0
}
```

### 8.2 Log de diagnóstico

Cada comando ADMS enviado é logado com:

- `operation_id`
- `command_id` (FK para `commands.id`)
- Payload (sem o base64, apenas metadados: tamanho, pin, tipo)
- `Return` recebido
- `attempt_count`
- Timestamp

### 8.3 Status por usuário na tabela do dashboard

| Coluna | Descrição |
|---|---|
| `photo_synced_at` IS NOT NULL | Sincronizado (com timestamp da confirmação) |
| `photo_synced_at` IS NULL e ops pending | Sincronizando |
| ops em status `error` com attempts < max | Aguardando retry |
| ops em status `critical` | Falha — intervenção manual necessária |

O frontend deve buscar `/api/users` (que inclui `photo_synced_at`) e exibir um ícone de status ao lado do avatar.

---

## 9. Reconciliação Periódica

Como o firmware não permite download de fotos, a reconciliação é baseada em metadados:

1. **Diariamente:** o servidor verifica `photo_ops` com `status != 'success'` e `created_at < now() - 24h`. Reenfileira automaticamente se `attempt_count < max_attempts`.

2. **Semanalmente (manual ou agendado):** o operador acessa `/api/photo-ops/reconcile` que:
   - Lista todos os usuários com `photo_blob IS NOT NULL`
   - Para cada um sem `photo_synced_at` ou sem ops com `status='success'` recentes: reenfileira upsert

3. **Limitação fundamental:** sem pull de fotos, não há como verificar se o REP realmente armazenou a imagem correta. O `Return=1` do devicecmd é a única confirmação disponível.

---

## 10. Melhorias Opcionais

### 10.1 Compressão progressiva com qualidade adaptativa

A função `optimizeForRep` já implementa compressão progressiva. Melhoria sugerida: registrar a qualidade final usada em `users.photo_quality` para diagnóstico.

### 10.2 Chunked upload para grandes imagens

O protocolo ADMS não suporta chunking nativo. Para imagens > 20 KB após otimização, a única alternativa é reduzir ainda mais a qualidade. Se o limite de 20 KB for removível, o campo `Size` no comando ADMS pode receber valores maiores — testar com o firmware específico.

### 10.3 Fila priorizada

Dar prioridade a deletes sobre upserts na fila para garantir que remoções de segurança cheguem ao REP antes de novas fotos.

### 10.4 Notificação por webhook

Ao marcar uma operação como `critical`, disparar um webhook para um endpoint configurável (Slack, email relay, etc.).

### 10.5 Compressão WebP

O firmware VDE2252800062 aceita JPEG e possivelmente PNG. WebP não é garantido. Manter JPEG como padrão.

---

## 11. Mapeamento de Requisitos do Contexto × Realidade ADMS

| Requisito original | Implementação real |
|---|---|
| `operation_id` único por comando | ✅ `photo_ops.operation_id` |
| Timestamp por operação | ✅ `photo_ops.created_at` |
| Status: success/error/not_found/hash_mismatch | ✅ Parcial: `success`/`error`/`critical` — `not_found` mapeado de `Return=-2`; `hash_mismatch` validado no servidor |
| Retry com backoff exponencial | ✅ `photo_ops.next_retry_at` + setInterval |
| Hash SHA-256 | ✅ No servidor (`users.photo_hash`); ❌ REP não valida |
| Autenticação por token | ❌ REP usa RegistryCode ADMS; token não suportado |
| TLS | Depende de proxy reverso (nginx/caddy) na frente do servidor |
| Resposta JSON do REP | ❌ REP responde texto plano `ID=N&Return=M` |
| `not_found` → upsert automático | ✅ Mapeado via `Return=-2` em op_type=upsert |
| `not_found` → success em delete | ✅ Mapeado via `Return=-2` em op_type=delete |

---

*Documento gerado em 2026-04-26. Atualizar se o firmware do REP for atualizado ou substituído.*
