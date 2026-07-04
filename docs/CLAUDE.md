# ZKTeco ADMS Dashboard — Notas para o Claude

## ⚠️ REGRA CRÍTICA — INFRAESTRUTURA COMPARTILHADA

**Este projeto compartilha conta Hostinger com aplicações de produção da UltraSistech.** Nunca alterar/reiniciar/deletar recursos das VPS abaixo sem autorização explícita do usuário (por escrito, nessa sessão):

| VPS | IP | ID Hostinger | Uso |
|---|---|---|---|
| **VPS-API-2.ultraponto** | 187.77.1.162 | 1451747 | Produção Ultraponto — API |
| **VPS-DB.ultraponto** | 72.62.173.226 | 1668455 | Produção Ultraponto — MySQL |
| **VPS.UltraCRM** | 31.97.165.88 | 922006 | Produção UltraCRM |

Se algum comando (Terraform, curl, ssh, gh, script) fizer referência a qualquer um desses IDs, IPs, hostnames, firewalls ou zonas DNS — **PARE e peça confirmação antes de executar**. A regra vale mesmo pra ações "só leitura" (probe TCP, `docker ps`, etc.) se envolver conectar naqueles hosts.

VPS gerenciada por este projeto:

| VPS | IP | ID | Uso |
|---|---|---|---|
| `zekateco-web.ultraponto` (renomeada de `srv784010.hstgr.cloud`) | 2.25.208.124 | 784010 | Produção zekateco-web (dashboard ADMS ZKTeco) |

Aplicações antigas nessa VPS foram removidas com autorização explícita em 2026-07-04 (containers `ultraponto-api`, `ultraponto-keycloak`, `ultraponto-redis` — do stack EBSERH antigo, descontinuado).

## ⚠️ REGRA CRÍTICA — CREDENCIAIS

- **`.env` e `.tfvars` NUNCA vão pro Git.** Já protegidos em `.gitignore` (raiz e `terraform/`).
- **Token Hostinger** fica em `/Users/jose-cleiton/dev/ssh/terraform-zekateco-web.txt` (chmod 600, carregado via `~/.zshrc`). NUNCA colar em log, PR, print ou commit.
- **SOLTECH_DB_URL** em produção só pode ser consultada com autorização explícita — banco pertence ao stack de produção da Ultraponto.

---

Projeto: dashboard web (Express + better-sqlite3 + WebSocket + React 19) que conversa com REPs ZKTeco via **Push Protocol** (ADMS). Os REPs ficam em modo cliente HTTP, fazem polling no servidor e empurram dados (logs, usuários, fotos).

Documento de referência: `Security PUSH Communication Protocol 20250429-1.pdf` (raiz do repo).

## Stack

- Backend: `server.ts` (single file). `npm run dev` = `tsx server.ts` (sem watch — restart manual após edição).
- DB: SQLite (`zkteco.db`) com tabelas `users`, `devices`, `logs`, `commands`. Coluna `users.photo_path` adicionada por migração idempotente.
- Frontend: `src/App.tsx` — Vite + React + Tailwind. WS auto-reconecta com backoff e dispara `window.location.reload()` se o `boot_id` do servidor mudar (servidor reiniciou).
- Static: pasta `photos/` servida em `/photos`. Avatares aparecem com `?v=<mtime>` para cache-bust.

## Endpoints HTTP que o REP usa

| Método | URL | Quando |
|---|---|---|
| GET  | `/iclock/ping?SN=...`         | heartbeat (raro nesse firmware) |
| POST | `/iclock/registry?SN=...`     | handshake inicial |
| GET  | `/iclock/cdata?SN=...`        | init/configuração — **resposta deve incluir `BioPhotoFun=1`, `BioDataFun=1`** |
| POST | `/iclock/cdata?SN=...&table=...` | upload de logs/fotos (push automático) |
| POST | `/iclock/querydata?SN=...&tablename=...` | resposta a `DATA QUERY` |
| GET  | `/iclock/getrequest?SN=...`   | long-poll de comandos pendentes |
| POST | `/iclock/devicecmd?SN=...`    | ack de comandos (`ID=N&Return=M&CMD=...`) |

## Heartbeat e session reaper

Keep-alive HTTP/1.1 mantém o socket aberto. Para detectar zombi:
- `updateDeviceSeen` é chamado em todos os handlers acima (cdata/querydata/getrequest/devicecmd/ping/registry).
- Map `deviceSessions: SN -> {socket, lastSeen}` rastreia o socket em uso.
- `setInterval` 15s: socket sem atividade > 60s → `socket.destroy()`. Força o REP a reabrir e re-fazer registry. Resolveu o problema "REP fica online só após reiniciar manualmente o REP".
- `socket.once('close')` é anexado **uma vez por socket** (flag `_zkCloseAttached`) para evitar `MaxListenersExceededWarning` em keep-alive.

## Fotos (lições aprendidas — ler antes de mexer)

### Caminhos suportados

1. **Push automático ao cadastrar/editar foto no REP** (✅ funciona):
   - URL: `POST /iclock/cdata?SN=...&table=userpic` — alguns firmwares usam `table=tabledata` ou `tablename=biophoto`.
   - Body: `userpic\tpin=N\tfilename=N.jpg\tsize=NNN\tcontent=<base64-jpeg>`
   - Em algumas firmwares o `content=` vem em **segunda linha** após `\n` — o parser precisa dividir por boundary do prefixo (`userpic|biophoto`), não por `\n`.
   - **Resposta obrigatória**: `Content-Type: text/plain`, body `userpic=N` (ou `biophoto=N`), e **`Connection: close`** (PDF p.5121). Sem o `Connection: close`, o REP entra em loop reenviando a mesma foto.

2. **Pull via `DATA QUERY tablename=biophoto,fielddesc=*,filter=Type=9`** (✅ FUNCIONA em versão atual do firmware VDE2252800062):
   - Hybrid identification protocol exige `filter=Type=N` (Type=9 = Visible Light Face, Type=2 = NIR Face — Appendix biometric types).
   - Confirmado em 2026-07-04: REP responde com `packcnt=N` reais e envia as fotos em pacotes de ~20-60KB cada. `Return=N` no devicecmd = número de records retornados.
   - **Nota histórica**: em versões anteriores desse mesmo firmware o pull retornava `count=0&packcnt=0` (só contava, não enviava). Após update do firmware, passou a enviar. Se voltar a falhar, cair pra push automático via re-cadastro manual.
   - **queueInitialCommands + safety-net (5min)** já enfileira esse pull automaticamente — fotos populam sozinhas.

3. **`DATA QUERY tablename=userpic`** (❌ NÃO suportado):
   - Devicecmd responde `Return=-1` (= unsupported command). Não enfileirar.

### Parser

`parseAndSavePhotos(sn, body, kind, source)` em `server.ts`:
- Divide body por boundary `^(userpic|biophoto)\s` (multiline regex), não por `\n` — porque `content=` pode estar em segunda linha.
- Junta o registro com `[\t\n]+` como delimitador.
- Decodifica `content` (base64), remove whitespace, sniff de magic bytes (JPEG `FF D8 FF` / PNG `89 50 4E 47`).
- Templates biométricos binários (Type=2 sem ser imagem) caem fora pelo magic byte.
- Dedup: se o arquivo em `photos/<pin>.<ext>` já tem mesmos bytes, não reescreve nem broadcasta.
- Salva em `photos/<pin>.jpg` ou `.png` e atualiza `users.photo_path`.

### Tipos biométricos (Appendix Type code)

| Type | Significado |
|---|---|
| 0 | General |
| 1 | Fingerprint |
| 2 | Face (Near Infrared) |
| 3 | Voice Print |
| 4 | Iris |
| 5 | Retina |
| 6 | Palm Print |
| 7 | Finger Vein |
| 8 | Palm |
| 9 | **Visible Light Face** ← onde mora a foto JPEG do usuário |
| 10 | Visible Light Palm |

## Comandos relevantes (server → REP)

Enfileirados em `commands` table, entregues via `getrequest` (`C:<id>:<cmd>\r\n`):

- `DATA QUERY tablename=user,fielddesc=*,filter=*` — funciona, retorna lista de usuários.
- `DATA UPDATE user Pin=...\tName=...\tPrivilege=...\tPassword=...\tCardNo=...` — cria/atualiza usuário.
- `DATA UPDATE userauthorize Pin=...\tAuthorizeTimezoneId=1\tAuthorizeDoorId=1` — autoriza acesso.
- `DATA DELETE user Pin=...` — remove usuário.
- `SET OPTIONS FVInterval=7` — ajusta intervalo de verificação facial.

**Não enfileirar** (firmware VDE2252800062 não responde com dados):
- ~~`DATA QUERY tablename=biophoto,filter=Type=9` (count > 0 mas body vazio)~~ — **desatualizado**: agora funciona; enfileirado automaticamente pelo backend.
- `DATA QUERY tablename=userpic` (Return=-1).

## Devicecmd / Return code

`POST /iclock/devicecmd` com body `ID=<cmdid>&Return=<n>&CMD=...`:
- `Return=N` (positivo) = N records processados com sucesso (count, NÃO erro).
- `Return=-1` = comando desconhecido / não suportado.
- `Return=0` = sucesso sem records (ex: query que retornou vazio).
- Outros negativos = códigos de erro (Appendix 1 / 17 do PDF).

Atualmente a coluna `commands.status` recebe `2` se Return=0 e `3` em qualquer outro caso. Isso é **enganoso** — Return positivo é sucesso. Não bloqueia funcionamento porque nada lê `status` para decisão.

## Init/cdata GET response (registro de capacidades)

```
registry=ok
RegistryCode=REG_<SN>_xyz789
ServerVersion=3.1.2
PushProtVer=3.1.2
RequestDelay=30
TransTimes=00:00;14:00
TransInterval=1
Realtime=1
BioPhotoFun=1
BioDataFun=1
Encryption=None
```

`BioPhotoFun=1` e `BioDataFun=1` declaram que o servidor aceita upload de foto e template — sem isso alguns devices não enviam.

## Body parser

`app.use(express.text({ type: "*/*", limit: "10mb" }))` — todos os bodies vêm como string em `req.body`.

Content-Type observado do REP: `application/push;charset=UTF-8`. O parser captura via `type: "*/*"` mesmo. Se em algum momento aparecer `multipart/...` para foto, vai precisar de `multer` ou `express.raw`.

## Frontend (`src/App.tsx`)

- WS reconecta com backoff de 1.5s. Servidor manda `{ type: "hello", boot_id }` no connect; mudança de boot_id → `window.location.reload()`.
- Eventos broadcast: `device_update`, `users_updated`, `new_log`, `command_result`, `hello`.
- Tabela "Usuários no Sistema" tem coluna de avatar com fallback `<Users>` icon. `photo_url` vem de `/api/users` com `?v=<mtime>` para cache-bust.

## Reference project

`/Users/jose-cleiton/dev/Soltech` (NestJS + Prisma) tem implementação madura do mesmo protocolo. Usar como referência ao adicionar suporte a algo novo (ex: snapshots de attphoto, SIP, etc).

## Quirks do REP VDE2252800062 (firmware específico)

- Não atualiza `last_seen` via `/iclock/ping` — usa só `getrequest` como heartbeat. Por isso `updateDeviceSeen` foi adicionado em todos os handlers.
- ~~`DATA QUERY tablename=biophoto` retorna count mas não envia dados~~ — **atualizado 2026-07-04**: pull agora funciona, retorna as fotos em pacotes. Enfileirado automaticamente em `queueInitialCommands` + safety-net.
- `DATA QUERY tablename=userpic` não é suportado (Return=-1).
- Push automático de userpic é rapidíssimo e correto após edit no REP.
- Em algum loop antigo, o REP enviava a mesma foto repetidamente até receber resposta com `Connection: close`.
