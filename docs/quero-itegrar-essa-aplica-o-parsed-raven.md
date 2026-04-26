````markdown
# Integração zekateco-web → Backend Soltech (S3 + Keycloak + filtro por REP)

## Contexto

O `zekateco-web` hoje é um app full-stack pequeno: Express + better-sqlite3 + WebSocket próprio em `server.ts`, com fotos em disco e protocolo ADMS implementado direto. Funciona só com o REP local da máquina e sem autenticação.

Já existe um backend maduro Soltech (NestJS + Prisma/MySQL + MongoDB + Keycloak + S3) que **já implementa** todo o protocolo ADMS, sincroniza usuários/fotos com REPs, autentica via Keycloak e armazena fotos biométricas em S3 (`biometrics/{userId}/face-photo.jpg`). O Soltech atende várias organizações com vários REPs simultaneamente.

A meta é desacoplar o `zekateco-web`: ele deixa de ter backend próprio e passa a ser um **frontend SPA** que consome dados do Soltech. O servidor Express (`server.ts`) e o SQLite são descartados. Toda foto vem do S3 via endpoints do Soltech (limitação do REP ZKTeco que não suporta pull de fotos — Soltech é a fonte de verdade). O dashboard mostra só REPs ZKTeco da organização e, ao selecionar um REP, todas as telas (usuários, fotos, registros) ficam restritas àquele REP.

## Restrições do usuário (não negociáveis)

1. **Não modificar nada no Soltech** — apenas o `zekateco-web` muda. O Soltech é consumido como API.
2. **Soltech é o único backend de dados** — `server.ts`, `zkteco.db` e `photos/` são removidos do `zekateco-web`. CRUD, ADMS, fotos S3, ponto, sync com REPs — tudo é Soltech.
3. **Fotos exclusivamente do S3 via Soltech** — todo CRUD de foto passa por `POST/GET/PUT /biometric` (Soltech proxia o S3). Nenhuma cópia local.
4. **Filtragem por REP ZKTeco selecionado** — só `model == "ZKTeco SenseFace"` aparecem; ao escolher um REP no topbar, usuários, fotos e logs/checkins ficam restritos a esse REP.
5. **WebSocket em serviço separado** — para real-time tipo webapp moderna, sobe um microserviço dedicado (`zekateco-realtime`) que escuta o Soltech e expõe Socket.io para o frontend. Soltech permanece intocado.

## Decisões confirmadas

| Tópico | Escolha |
|---|---|
| Filtro de REP | `Rep.model === "ZKTeco SenseFace"` (string literal usada em `rep.controller.ts:552`) |
| Escopo do filtro por REP | Tudo: usuários (via `RepsOnUsers[repId=X]`), fotos e logs/checkins |
| Autenticação | Keycloak Authorization Code + PKCE com `oidc-client-ts` + `react-oidc-context` |
| Deploy | Vite dev (proxy → Soltech) + build estático em `Soltech/static/app/` para produção |
| WebSocket | **Microserviço dedicado `zekateco-realtime`** (Node + Socket.io) que polla Soltech a cada 3s e emite eventos para o frontend. Roda separado, sem persistência, stateless. Soltech permanece intocado. |

## Arquitetura — 3 componentes independentes

```text
┌──────────────────────────────────────────────────────────────────┐
│ zekateco-web/  (Vite SPA — só UI, sem backend)                   │
│  ├─ src/auth.ts ───── Keycloak (oidc-client-ts + PKCE)           │
│  ├─ src/api.ts  ────► Soltech (Bearer JWT) — CRUD + fotos S3     │
│  ├─ src/ws.ts   ────► zekateco-realtime (Socket.io) — eventos    │
│  └─ src/state/useAppState.ts ── selectedRepId filtra tudo        │
└──────────────────────────────────────────────────────────────────┘
                  │                            │
                  │ HTTPS                      │ wss
                  ▼                            ▼
┌────────────────────────────────┐   ┌─────────────────────────────┐
│ Soltech (porta 8080)           │   │ zekateco-realtime (porta    │
│ — INTOCADO                     │◄──┤  8090) — NOVO repo          │
│  /user, /rep, /biometric,      │   │  ├─ Polling cliente HTTP    │
│  /log, /checkin, /iclock/*     │   │  │   /checkin?since=...     │
│  ├─ Keycloak guard             │   │  │   /rep, /log             │
│  ├─ S3 (biometrics/...)        │   │  ├─ Diff + dedup            │
│  └─ Prisma (MySQL) + Mongo     │   │  └─ Socket.io gateway       │
└────────────────────────────────┘   │     com auth JWT Keycloak   │
                                     └─────────────────────────────┘
```

**Por que serviço separado, não dentro do `zekateco-web`?**

- Soltech não pode ser modificado, então não há `/socket.io` lá. Precisamos de uma "ponte" externa.
- Ter o WS no mesmo processo do Vite/SPA acopla concerns: SPA roda no browser, WS precisa rodar no servidor. Um build estático em `Soltech/static/app/` (deploy alvo) não tem onde hospedar Node.
- Componente isolado é trivial de escalar/reiniciar/debugar — log próprio, métricas próprias, deploy próprio. Comportamento típico de webapp moderna (frontend + serviço de sockets + API).

## `zekateco-realtime` — novo repositório/pasta

Microserviço Node mínimo (TypeScript). Estrutura:

```text
zekateco-realtime/
  package.json
  tsconfig.json
  src/
    index.ts          # bootstrap: HTTP + Socket.io
    config.ts         # env vars (SOLTECH_URL, KEYCLOAK_URL, PORT, POLL_INTERVAL_MS)
    auth.ts           # valida JWT Keycloak via JWKS (jose lib)
    soltech-client.ts # axios/fetch para Soltech, com token de service account
    poll/
      checkins.ts     # polling /checkin desde lastSeenAt; emite checkin.created
      reps.ts         # polling /rep; emite rep.status.changed quando online flip
      users.ts        # polling /user (mais lento, 30s); emite user.changed
      biometrics.ts   # polling biométrico via /user (campo facePhotographS3); emite biometric.updated
    ws-server.ts      # Socket.io: rooms por organizationId + repId
```

**Deps mínimas:** `socket.io`, `jose` (JWT verify), `node-fetch` (ou nativo no Node 22), `dotenv`, `pino` (logs).

**Stateless:** todos os "since cursors" (`lastSeenCheckinId`, etc) ficam só em memória. No restart, perde 5–10s de eventos antigos — aceitável (frontend recarrega via fetch HTTP ao conectar).

**Auth do bridge:**

- **Para o frontend** (entrada): Socket.io `auth.token` é o mesmo JWT Keycloak do usuário. O bridge valida via JWKS público do Keycloak (`/realms/Ultraponto/protocol/openid-connect/certs`) e extrai `organization_id`. Sockets entram em room `org:${organizationId}`.
- **Para o Soltech** (saída): bridge usa o JWT do **usuário conectado** repassado, OU um service account dedicado (criar client confidential Keycloak `ultraponto-realtime` com client_credentials grant). Recomendado: **service account** — bridge mantém um token cacheado e renova com refresh, e faz polling com ele. Cada evento é depois filtrado no servidor por `organizationId` antes de emitir só para a room daquela org.

**Eventos emitidos para o frontend (room `org:${orgId}` ou `rep:${repId}`):**

| Evento | Payload | Polling source |
|---|---|---|
| `checkin.created` | `{ id, userId, repId, time, status, verifyType }` | `GET /checkin?since=<id>&take=200` cada 3s |
| `rep.status.changed` | `{ repId, online, timeOfLastCom }` | `GET /rep` cada 10s, diff |
| `user.changed` | `{ userId, repId? }` | `GET /user` cada 30s, diff por `updatedAt` |
| `biometric.updated` | `{ userId }` | `GET /user` campo `userBiometrics.facePhotographS3` mudou |
| `connection.ack` | `{ buildId, serverTime }` | Emitido no `handleConnection` |

**O frontend escuta cada evento e faz update incremental no estado** — sem precisar refetch global. Webapp reativa de verdade.

## Mapeamento Frontend → Endpoints Soltech existentes

| Antiga API (server.ts) | Endpoint Soltech | Adaptação |
|---|---|---|
| `GET /api/devices` | `GET /rep` | Filtrar `model === "ZKTeco SenseFace"` no client |
| `GET /api/users` | `GET /user` | Filtrar `users` cuja `repsOnUsers[].repId === selectedRepId`; mapear para `UiUser` |
| `GET /api/logs` | `GET /log?repId=X` ou `GET /checkin?repId=X` | Verificar query param suportado durante implementação |
| `GET /api/config` | — | Removido. Versão do build vem de `import.meta.env.VITE_APP_VERSION` |
| `POST /api/users` | `POST /user/register` | Mapear `pin → employeeId`, `name → firstName/lastName`. Email/CPF/orgId vem do form ou JWT |
| `PUT /api/users/:pin` | `PATCH /user/:id` | Frontend opera com UUID `id` internamente |
| `DELETE /api/users/:pin` | `DELETE /user/:id` | idem |
| `POST /api/users/:pin/photo` (multipart) | `POST /biometric` (multipart `facePhotograph` + body `id`) | Soltech faz upload S3 + dispara `rep.evo.user-changed` (sync REP automática) |
| `POST /api/users/:pin/photo/sync` | Reupload da foto via `PUT /biometric/:id` | Reaproveita o evento `rep.evo.user-changed` já disparado pelo Soltech |
| `DELETE /api/users/:pin/photo` | `PUT /biometric/:id` com `facePhotograph: null` | Já tratado em `user-biometrics.service.ts` |
| `GET /photos/{pin}.jpg` | `GET /biometric/:id` | Hook `usePhotoBlob(userId)` faz fetch com Bearer + `URL.createObjectURL(blob)` |
| `POST /api/sync-users` | `POST /rep/:id/command` (com payload "fetch users") | Verificar tipos de comando aceitos durante D.4 |

## Estrutura nova do `zekateco-web`

### Removidos
- `server.ts`, `zkteco.db`, `photos/` (pasta inteira), `dist/` (regerado)
- Deps: `better-sqlite3`, `express`, `multer`, `sharp`, `ws`, `@types/{express,multer,ws}`, `tsx`, `dotenv`
- Script `dev: tsx watch server.ts` → `dev: vite`

### Adicionados
| Arquivo | Função |
|---|---|
| `src/auth.ts` | `UserManager` OIDC + helper `getAccessToken()` para uso fora de componente |
| `src/api/soltech-types.ts` | Tipos crus do Soltech (User, Rep, Checkin) — mantém os tipos UI separados |
| `src/api/mappers.ts` | `mapUserToUi`, `mapRepToUi`, `mapCheckinToLog` — adapta payload Soltech → tipos atuais |
| `src/hooks/usePhotoBlob.ts` | `(userId) => string \| null` — fetch com Bearer e `URL.createObjectURL`, revoga ao desmontar |
| `src/components/shell/RepSelector.tsx` | Dropdown no `TopBar` com REPs ZKTeco da org; salva `selectedRepId` no estado global e em `localStorage` |
| `src/screens/LoginScreen.tsx` | Tela mostrada quando `!auth.isAuthenticated` |
| `src/screens/CallbackScreen.tsx` | Recebe redirect `/auth/callback`, chama `signinCallback`, vai pra home |

### Modificados
| Arquivo | Mudança |
|---|---|
| `package.json` | Remover deps backend, adicionar `oidc-client-ts ^3`, `react-oidc-context ^3`, `socket.io-client ^4.8` |
| `vite.config.ts` | Bloco `server.proxy` para `/user`, `/biometric`, `/rep`, `/log`, `/checkin` → `http://localhost:8080`. Em produção, `base: '/app/'` |
| `src/main.tsx` | Wrap em `<AuthProvider>` (de `react-oidc-context`) |
| `src/App.tsx` | Tratar `/auth/callback`, mostrar `LoginScreen` se `!isAuthenticated`, trocar `u.pin` por `u.id` em keys/handlers (mantém display do `pin` na UI), receber `selectedRepId` do `useAppState` |
| `src/state/useAppState.ts` | Adicionar `selectedRepId`, `setSelectedRepId`, `availableReps`. `users` filtrado por REP. Updates incrementais via callbacks do `ws.ts` (sem polling no frontend — quem polla é o `zekateco-realtime`) |
| `src/api.ts` | Reescrita: `authFetch` com Bearer, métodos novos, sempre passando `repId` quando relevante |
| `src/types.ts` | `UiUser` com `id` (UUID) + `pin` (matrícula display); `Rep` com novo campo `model`; `photoSync`/`userSync` viram `null` (degradação consciente) |
| `src/ws.ts` | `socket.io-client` apontando para `VITE_REALTIME_URL`. Auth via `auth: { token: getAccessToken() }`. Listeners para `checkin.created`, `rep.status.changed`, `user.changed`, `biometric.updated`, `connection.ack`. Reconexão automática nativa do Socket.io |
| `src/components/shell/TopBar.tsx` | Adicionar `<RepSelector />` ao lado direito do logo |
| `src/screens/UsersListScreen.tsx` | Trocar `u.pin` por `u.id` em key/seleção; coluna "ID" exibe `pin` (matrícula). Botões de bulk delete/sync usam `id`. Badges photoSync/userSync simplificados (presença de foto vs erro de fetch) |
| `src/screens/{NewUser,EditUser}Screen.tsx` | Adicionar `email` e `cpf` (obrigatórios no Soltech), tirar campo `privilege` (regrade futura) |
| `src/screens/RealtimeScreen.tsx` | Carrega últimos 50 via `GET /checkin?repId=X&take=50` no mount; depois recebe `checkin.created` via WS e prepende reativo |
| `src/screens/InfoRegScreen.tsx` + `RelatorioScreen.tsx` | Filtro de data + `repId` na query do `/log` ou `/checkin` |
| `src/screens/HomeScreen.tsx` | Stats derivados do REP selecionado (count users, count fotos, last sync) |
| `src/screens/DispositivoScreen.tsx` | Mostra dados do REP selecionado (`name`, `serial`, `ipAddress`, `online`, `timeOfLastCom`, `model`) |
| `index.html` | `<title>Ultraponto Webserver</title>`, ícone Ultraponto |

## Etapas executáveis (sprint de 5 dias)

### D.0 — Pré-requisitos (1h)
- Subir Soltech: `cd /Users/jose-cleiton/dev/Soltech && docker compose up -d`
- Validar `http://localhost:8080/api` (Swagger) e `http://localhost:9092` (Keycloak admin)
- Confirmar que existem REPs com `model === "ZKTeco SenseFace"` no banco — caso contrário, criar 1 via `POST /rep` para testar

### D.1 — Criar client público Keycloak `ultraponto-web` (30min)
No Keycloak admin (`http://localhost:9092` → realm Ultraponto → Clients → Create):
- Type: OpenID Connect
- Client ID: `ultraponto-web`
- Client authentication: **OFF** (público)
- Authentication flow: Standard flow ON, PKCE required (`Advanced settings → Proof Key for Code Exchange = S256`)
- Valid Redirect URIs: `http://localhost:5173/auth/callback`, `http://localhost:8080/app/auth/callback`
- Web Origins: `+`

### D.2 — Cleanup do `zekateco-web` (1h)

- `rm server.ts zkteco.db && rm -rf photos/`
- Editar `package.json` (remover deps backend, adicionar `oidc-client-ts`, `react-oidc-context`, `socket.io-client`)
- `npm install`
- Adicionar `vite.config.ts` com proxy `/user`, `/biometric`, `/rep`, `/log`, `/checkin` → Soltech (8080) e `/socket.io` → realtime (8090)
- Criar `.env.local`:

  ```env
  VITE_KEYCLOAK_URL=http://localhost:9092
  VITE_KEYCLOAK_REALM=Ultraponto
  VITE_KEYCLOAK_CLIENT_ID=ultraponto-web
  VITE_API_URL=
  VITE_REALTIME_URL=
  ```

### D.3 — Auth + skeleton (3h)
- Criar `src/auth.ts` com `UserManager` configurado
- Wrap em `main.tsx` com `<AuthProvider>`
- Em `App.tsx` no início, tratar pathname `/auth/callback` → `signinCallback()` + redirect
- Mostrar `<LoginScreen>` quando `!auth.isAuthenticated` com botão "Entrar com Keycloak" → `auth.signinRedirect()`
- Validar: login redireciona, volta com token, `useAuth().user?.access_token` retorna válido

### D.4 — Reescrever `api.ts` + RepSelector (4h)
- `authFetch` interno injetando Bearer
- Implementar todos os métodos da tabela acima
- Criar `src/api/mappers.ts` para `mapUserToUi`, `mapRepToUi`, `mapCheckinToLog`
- `useAppState` filtra `availableReps` por `model === "ZKTeco SenseFace"`
- `RepSelector.tsx` no `TopBar`: dropdown que seta `selectedRepId` no estado global + `localStorage("ultraponto:selected-rep")`
- Validar: cada endpoint via DevTools (login → `GET /rep` retornando lista filtrada → `GET /user` filtrado por `selectedRepId`)

### D.5 — Adaptar telas (3h)

- Trocar `u.pin` por `u.id` como **key** React e parâmetro de ações em `App.tsx`, `UsersListScreen.tsx`, `EditUserScreen.tsx`. **Manter** `u.pin` no display (coluna "ID")
- `usePhotoBlob(userId)` hook usado em todas as `<img>` — substitui `<img src={photo_url}>`
- `NewUserScreen` adiciona campos `email`, `cpf`. `organizationId` vem de `useAuth().user?.profile?.organization_id` (claim Keycloak)
- `EditUserScreen` carrega usuário por `id`, faz `PATCH /user/:id`
- `InfoRegScreen` e `RelatorioScreen` enviam `repId` + `dateBegin`/`dateEnd` ao filtrar
- `DispositivoScreen` lê `selectedRep` do estado e mostra `name/sn/model/ip/online/timeOfLastCom`
- `HomeScreen` mostra contadores derivados do REP selecionado

### D.6 — Criar `zekateco-realtime` (4h)

- Novo repo/pasta `/Users/jose-cleiton/dev/zekateco-realtime/` (irmão de zekateco-web e Soltech)
- `npm init` + deps: `socket.io ^4.8`, `jose ^5`, `dotenv`, `pino`, `tsx` (dev)
- `src/auth.ts`: valida JWT do frontend via JWKS Keycloak (`/realms/Ultraponto/protocol/openid-connect/certs`); cacheia chaves por 1h; extrai `organization_id` e `sub`
- `src/soltech-client.ts`: cliente para Soltech autenticado via service account (client_credentials grant em Keycloak; criar client confidential `ultraponto-realtime`); refresh automático de token (60s antes de expirar)
- `src/poll/checkins.ts`: cada 3s, `GET /checkin?since=<lastId>&take=200`; para cada novo, emite `checkin.created` na room `org:${orgId}` filtrando por `repId`
- `src/poll/reps.ts`: cada 10s, `GET /rep`; mantém Map `id → online`; emite `rep.status.changed` quando flip
- `src/poll/users.ts`: cada 30s, `GET /user`; diff por `updatedAt`; emite `user.changed`
- `src/poll/biometrics.ts`: junto com `users.ts`, detecta mudança em `userBiometrics.facePhotographS3` ou `updatedAt`; emite `biometric.updated`
- `src/ws-server.ts`: Socket.io com middleware de auth; `socket.join('org:' + orgId)`; `connection.ack` no connect
- `src/index.ts`: bootstrap HTTP server na porta 8090, monta Socket.io
- `package.json` script `dev: tsx watch src/index.ts`, `start: node dist/index.js`
- Validar: subir o serviço, conectar via DevTools `wsuri = "ws://localhost:8090"; new WebSocket(wsuri)` e ver `connection.ack`

### D.7 — Frontend integra Socket.io (1h)

- `src/ws.ts` — substituir stub:
  ```ts
  import { io } from "socket.io-client";
  export function connectRealtime(getToken: () => Promise<string>) {
    return io(import.meta.env.VITE_REALTIME_URL || "/socket.io", {
      auth: async (cb) => cb({ token: await getToken() }),
      transports: ["websocket"],
    });
  }
  ```
- `useAppState`: ao montar, conecta socket; listeners atualizam estado incremental:
  - `checkin.created` → prepende em `logs`
  - `rep.status.changed` → atualiza `availableReps` (online flip)
  - `user.changed` → refetch user específico via `GET /user/:id` ou refresh `users`
  - `biometric.updated` → invalida `usePhotoBlob` cache do `userId`
- Sem `setInterval` no frontend. Reconexão é nativa do Socket.io (com backoff).
- Indicador "Online/Offline" no topbar baseado em `socket.connected`

### D.8 — Build + servir do Soltech (1h)

- Definir `base: '/app/'` em `vite.config.ts` (production)
- `npm run build` gera `dist/`
- Script `scripts/deploy-to-soltech.sh`:

  ```bash
  rm -rf /Users/jose-cleiton/dev/Soltech/static/app
  cp -r dist /Users/jose-cleiton/dev/Soltech/static/app
  ```

- Acessar `http://localhost:8080/app/` — `useStaticAssets('static')` do Soltech (em `main.ts:63`) entrega o SPA. CORS já habilitado para chamadas a `localhost:8090` do realtime.

### D.9 — Validação E2E (2h)

1. Acessar `http://localhost:8080/app/` → redirect para Keycloak
2. Login → ver REP selector com REPs ZKTeco da org
3. Confirmar bolinha "Online" no topbar (Socket.io conectado)
4. Selecionar REP → lista de usuários filtrada (apenas vinculados via `RepsOnUsers`)
5. Criar usuário → confirmar no banco Soltech (Prisma Studio: `User`, `EmployeeProfile`, `EmployeeLink`)
6. Upload foto → confirmar S3: `aws s3 ls s3://${AWS_S3_PHOTOS_BUCKET_NAME}/biometrics/${userId}/`
7. Confirmar evento `biometric.updated` chegou no frontend (DevTools → WS frame); avatar atualiza sozinho
8. Bater ponto no REP físico → em até 3s aparece em "Registros em Tempo Real" via WS (sem refresh manual)
9. Derrubar REP → após 10–15s aparece "Offline" no topbar via `rep.status.changed`
10. Trocar de REP no topbar → todas as telas atualizam

## Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | `GET /user` retorna entidade pesada (~30 relations) | `mapUserToUi` descarta tudo menos `id, firstName, lastName, employeeProfile.repPassword, employeeLinks[0].registration, repsOnUsers[].repId, userBiometrics?.facePhotographS3`. Avaliar performance com 200+ users; se lento, considerar query param `?fields=` se Soltech aceitar (verificar) |
| R2 | `<img src>` não pode mandar Bearer | `usePhotoBlob` hook faz `fetch` + `URL.createObjectURL(blob)`. Cleanup com `URL.revokeObjectURL` no unmount. ~30 linhas |
| R3 | `/log` ou `/checkin` pode não aceitar `?repId=` | Verificar em D.4. Plan B: filtrar client-side após fetch (até 100 itens) |
| R4 | `zekateco-realtime` perde eventos durante restart (polling stateless) | Aceitável: ao reconectar, frontend chama `GET /checkin?take=50&repId=X` e remonta lista. Apenas 5–10s de gap |
| R11 | Race condition entre upload de foto e `biometric.updated` | Frontend faz update otimista local após upload bem-sucedido; quando WS chegar com mesma versão, é no-op. Hash/updatedAt como discriminator |
| R12 | Polling do realtime gera carga em Soltech (~1 req/s combinado) | Aceitável para org pequena/média. Se escalar, usar `If-Modified-Since` ou ETag. Ou substituir por MongoDB change streams se logs estão em Mongo |
| R13 | Service account `ultraponto-realtime` precisa permissões amplas | Criar role `realtime-poller` no Keycloak com escopo só de leitura (`view-employees`, `view-rep`, `view-checkins`); evitar `crud-*` |
| R5 | Privilege/admin do REP some no formulário | Aceitar regressão. Roles agora vivem no Keycloak; UI esconde o campo |
| R6 | Modelo de usuário Soltech exige `email`/`cpf` | Frontend pede esses campos no `NewUserScreen`. Para usuários cadastrados via REP (ADMS), o `iclock.controller.ts` já trata sem esses campos |
| R7 | Usuário operador sem permissão `crud-employees` | Botões de criar/editar/excluir desabilitados se token não tem a role. Ler de `useAuth().user?.profile?.realm_access?.roles` |
| R8 | Keycloak realm não tem o claim `organization_id` no token | Verificar em D.3. Se faltar, fazer `GET /user/me` após login para obter `organizationId` e cachear |
| R9 | Build SPA não cair em rotas internas | Hoje o app só usa estado interno (não react-router). Acessos a `/app/qualquer-coisa` que não exista cairão em `index.html` direto. Confirmar em D.7 |
| R10 | `selectedRepId` em `localStorage` aponta para REP que sumiu da lista | Validar contra `availableReps` ao carregar; se inválido, fallback para `availableReps[0]?.id` |

## Verificação end-to-end

1. **Auth**
   ```bash
   curl -i http://localhost:8080/user # deve retornar 401
   # Pelo browser: login Keycloak → tela inicial do dashboard carrega
   ```

2. **Lista de REPs ZKTeco filtra corretamente**
   - Topbar mostra apenas REPs com `model === "ZKTeco SenseFace"`
   - Selecionar diferentes REPs → lista de usuários muda

3. **Foto vai para S3**
   - Upload foto pelo dashboard
   ```bash
   aws s3 ls s3://${AWS_S3_PHOTOS_BUCKET_NAME}/biometrics/${userId}/
   # → face-photo.jpg
   ```

4. **Foto chega no REP físico**
   - Após upload, REP recebe via `rep.evo.user-changed` → `RepAgentGateway` → push ADMS
   - Verificar logs do Soltech: `[RepAgentGateway] Replicating biometric to REP X`
   - Confirmar fisicamente no display do REP

5. **Logs/Checkins filtram por REP**
   - Bater ponto no REP A → aparece só quando REP A está selecionado no topbar
   - Trocar para REP B → some

6. **CRUD de usuário sincroniza com REP**
   - Criar usuário no dashboard → `RepsOnUsers` ganha entrada para `selectedRepId`
   - Editar nome → REP recebe `DATA UPDATE user`
   - Deletar → REP recebe `DATA DELETE user`

## Critical files

- **Frontend**:
  - `/Users/jose-cleiton/dev/zekateco-web/package.json`
  - `/Users/jose-cleiton/dev/zekateco-web/vite.config.ts`
  - `/Users/jose-cleiton/dev/zekateco-web/src/main.tsx`
  - `/Users/jose-cleiton/dev/zekateco-web/src/App.tsx`
  - `/Users/jose-cleiton/dev/zekateco-web/src/auth.ts` (novo)
  - `/Users/jose-cleiton/dev/zekateco-web/src/api.ts` (reescrita)
  - `/Users/jose-cleiton/dev/zekateco-web/src/api/mappers.ts` (novo)
  - `/Users/jose-cleiton/dev/zekateco-web/src/api/soltech-types.ts` (novo)
  - `/Users/jose-cleiton/dev/zekateco-web/src/hooks/usePhotoBlob.ts` (novo)
  - `/Users/jose-cleiton/dev/zekateco-web/src/components/shell/RepSelector.tsx` (novo)
  - `/Users/jose-cleiton/dev/zekateco-web/src/state/useAppState.ts`
  - `/Users/jose-cleiton/dev/zekateco-web/src/screens/UsersListScreen.tsx`
  - `/Users/jose-cleiton/dev/zekateco-web/src/screens/{NewUser,EditUser}Screen.tsx`
  - `/Users/jose-cleiton/dev/zekateco-web/src/screens/RealtimeScreen.tsx`
  - `/Users/jose-cleiton/dev/zekateco-web/src/types.ts`
  - `/Users/jose-cleiton/dev/zekateco-web/src/ws.ts`

- **`zekateco-realtime` (novo repo/pasta)**:
  - `/Users/jose-cleiton/dev/zekateco-realtime/package.json`
  - `/Users/jose-cleiton/dev/zekateco-realtime/src/index.ts`
  - `/Users/jose-cleiton/dev/zekateco-realtime/src/auth.ts`
  - `/Users/jose-cleiton/dev/zekateco-realtime/src/soltech-client.ts`
  - `/Users/jose-cleiton/dev/zekateco-realtime/src/ws-server.ts`
  - `/Users/jose-cleiton/dev/zekateco-realtime/src/poll/{checkins,reps,users,biometrics}.ts`

- **Soltech (apenas leitura — confirmar comportamentos)**:
  - `/Users/jose-cleiton/dev/Soltech/prisma/schema.prisma` — `Rep`, `User`, `RepsOnUsers`, `RepBiometricInfo`, `RepFacialInfo`
  - `/Users/jose-cleiton/dev/Soltech/src/main.ts` (`useStaticAssets`, `enableCors`)
  - `/Users/jose-cleiton/dev/Soltech/src/biometric/app/controllers/user-biometrics.controller.ts`
  - `/Users/jose-cleiton/dev/Soltech/src/biometric/app/services/user-biometrics.service.ts`
  - `/Users/jose-cleiton/dev/Soltech/src/services/s3-photo/s3-photo.service.ts`
  - `/Users/jose-cleiton/dev/Soltech/src/rep/app/controller/rep.controller.ts`
  - `/Users/jose-cleiton/dev/Soltech/src/user/app/controllers/user.controller.ts`
  - `/Users/jose-cleiton/dev/Soltech/docker-compose.yml`

## Sequência resumida (6 dias)

| Dia | Trabalho |
|---|---|
| 1 | D.0 + D.1 + D.2 + D.3 — Soltech rodando, clients Keycloak (`ultraponto-web` público + `ultraponto-realtime` confidential), login funcionando |
| 2 | D.4 — `api.ts` completo, RepSelector no topbar |
| 3 | D.5 — telas adaptadas, foto via blob, filtro por REP funcionando via REST |
| 4 | D.6 — `zekateco-realtime` criado e emitindo eventos (validar com cliente CLI) |
| 5 | D.7 + D.8 — frontend integra Socket.io, build em `Soltech/static/app` |
| 6 | D.9 — validação E2E completa: login, CRUD, foto S3, sync REP, real-time |

Após este sprint:

- `zekateco-web` é um SPA puro consumindo Soltech (REST + Bearer JWT), com auth Keycloak, fotos exclusivamente em S3, e tudo filtrado pelo REP ZKTeco selecionado no topbar.
- `zekateco-realtime` roda como microserviço dedicado emitindo eventos Socket.io para o frontend; polla Soltech sem modificá-lo.
- Soltech permanece intocado.

````
