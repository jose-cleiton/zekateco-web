# zekateco-web

Dashboard web + gateway ADMS pra REPs ZKTeco (SenseFace 7A e similares). Recebe push automático do REP (logs, users, biofotos), gerencia a fila de comandos e serve um dashboard React com atualização em tempo real via WebSocket.

**Produção**: [http://2.25.208.124:81](http://2.25.208.124:81) — VPS `zekateco-web.ultraponto` na Hostinger (id 784010).
**Gateway ADMS** (endereço que o REP aponta): `http://2.25.208.124:8090`.

---

## Stack

- **Backend**: Express + Prisma (MySQL 8) — `server.ts` single file, ~1500 linhas
- **Frontend**: React 19 + Vite + Tailwind — em `src/`
- **Realtime**: WebSocket nativo (`ws`) com `boot_id` pra forçar reload após redeploy
- **Storage**: S3 (`ultraponto-varejo`) pra fotos biométricas + MySQL pra logs/config
- **Deploy**: Docker Compose no VPS (backend + frontend + MySQL)
- **CI/CD**: GitHub Actions (`ci.yml`, `terraform-plan.yml`, `terraform-apply.yml`, `deploy.yml`)
- **Infra**: Terraform (`terraform/`) — provider `hostinger/hostinger` + `null_resource` pra endpoints não cobertos

---

## Rodar localmente

Requisitos: Docker Desktop, Node.js 20+, MySQL local (ou via docker-compose incluso).

```bash
# 1) Clone
git clone git@github.com:jose-cleiton/zekateco-web.git
cd zekateco-web

# 2) Configura .env (copia o template e ajusta)
cp .env.docker.example .env
# ajuste MYSQL_*, S3_*, AWS_*, SOLTECH_*

# 3) Sobe tudo
docker compose up -d --build

# 4) Acessa
open http://localhost:81      # dashboard
# REPs em desenvolvimento apontam pra http://<seu-ip-local>:8090
```

### Comandos úteis do dev

```bash
docker compose logs -f backend           # logs em tempo real
docker compose exec db mysql -uroot -p   # shell MySQL
docker compose down                      # para tudo
docker compose down -v                   # para + apaga volumes (reset)
npm run lint                             # roda o mesmo que o CI (tsc --noEmit)
```

---

## Deploy em produção (GitOps)

O deploy pra `2.25.208.124` é 100% GitOps — não faz SSH manual. Fluxo:

```text
1. Cria branch:            git switch -c feat/minha-mudanca
2. Commit + push:          git push -u origin feat/minha-mudanca
3. Abre PR:                gh pr create --repo jose-cleiton/zekateco-web --base main
4. CI roda automático (~2min):
     • CI / typecheck          → tsc --noEmit
     • CI / docker-build       → build das 2 imagens (smoke test)
     • Terraform Plan (só se PR toca terraform/**)
5. Merge:                  gh pr merge <N> --repo jose-cleiton/zekateco-web --merge --admin
6. Deploy dispara sozinho, pausa aguardando approval no environment 'production'
7. Aprova via CLI (ver seção abaixo)
8. Deploy roda: SSH → docker compose up -d --build → health check (~40s)
```

### Aprovar e monitorar deploy via CLI

```bash
# 1. Descobre o RUN_ID do deploy pendente
gh run list --repo jose-cleiton/zekateco-web --workflow deploy.yml --limit 3
# procura o status "waiting"

RUN_ID=<cole-o-id>

# 2. Pega o environment ID (uma vez, guarda em variável)
ENV_ID=$(gh api /repos/jose-cleiton/zekateco-web/environments \
  -q '.environments[] | select(.name=="production") | .id')

# 3. Aprova
gh api --method POST \
  "/repos/jose-cleiton/zekateco-web/actions/runs/$RUN_ID/pending_deployments" \
  --input - <<EOF
{"environment_ids":[$ENV_ID],"state":"approved","comment":"deploy ok"}
EOF

# 4. Acompanha em tempo real até terminar
gh run watch $RUN_ID --repo jose-cleiton/zekateco-web
```

### Rollback

Reverter commit e deixar o CI/CD fazer o deploy da versão anterior:

```bash
git revert <sha-do-commit-quebrado>
git push origin main    # branch protection não permite push direto —
                        # use branch nova + PR (mesmo fluxo acima)
```

Ou, emergencial via SSH manual:

```bash
ssh root@2.25.208.124
cd /opt/zekateco-web
git reset --hard <sha-anterior>
docker compose up -d --build
```

---

## Infraestrutura — Terraform

Gerencia SSH key + firewall + DNS opcional da VPS existente (nunca cria/destrói VPS).

```bash
cd terraform/

# Token da Hostinger via env var (nunca commitar em .tfvars)
export TF_VAR_hostinger_api_token="$HOSTINGER_API_TOKEN"

terraform init
terraform plan     # sempre conferir antes
terraform apply
```

Ver [`terraform/README.md`](terraform/README.md) e [`docs/CLAUDE.md`](docs/CLAUDE.md) pra detalhes.

**⚠️ Aviso crítico**: a conta Hostinger tem 3 outras VPS de produção que NÃO são gerenciadas por este projeto (`VPS-API-2.ultraponto`, `VPS-DB.ultraponto`, `VPS.UltraCRM`). Detalhes no início do `docs/CLAUDE.md`.

---

## Setup inicial de um dev novo no projeto

Passo a passo pra um dev conseguir contribuir do zero:

### 1. Instalar ferramentas

```bash
brew install gh docker terraform
gh auth login   # autenticar no GitHub
```

### 2. Cadastrar SSH key

O repo é acessado via SSH (`git@github.com:...`). Se não tem chave:

```bash
ssh-keygen -t ed25519 -C "seu-email@exemplo.com"
gh ssh-key add ~/.ssh/id_ed25519.pub --title "meu-mac"
```

### 3. Clonar

```bash
git clone git@github.com:jose-cleiton/zekateco-web.git
cd zekateco-web
```

### 4. Pedir acesso ao `.env`

As credenciais (S3, Soltech, MySQL) não vão no repo. Peça pra alguém do time.

### 5. Rodar local

Seguir a seção [Rodar localmente](#rodar-localmente) acima.

Pra fazer deploy em produção, é necessário ser adicionado como `required_reviewer` no environment `production` — falar com `@jose-cleiton`.

---

## Secrets e credenciais

Nada de segredo vai pro Git. Onde cada tipo mora:

| Segredo | Local | Uso |
|---|---|---|
| `HOSTINGER_API_TOKEN` | `~/.hostinger/env` local + secret no GitHub | Terraform (local + CI) |
| `.env` (MySQL, S3, Soltech) | `/opt/zekateco-web/.env` no VPS | Backend em runtime |
| Chave SSH privada do VPS | secret `VPS_SSH_PRIVATE_KEY` no GitHub | Job `deploy.yml` |
| AWS access keys | dentro do `.env` (nunca no repo) | Backend acessa S3 |

Rotacionar qualquer um: gerar novo, atualizar no lugar apropriado, invalidar o antigo.

---

## Fluxo do REP → dashboard (sincronização automática)

O REP conversa com o gateway via ADMS Push Protocol (documento oficial `Security PUSH Communication Protocol` na raiz do repo). Como cada tipo de mudança se propaga pro dashboard:

| Mudança no REP | Como chega no backend | Latência |
|---|---|---|
| **Edição de user** (menu do REP) | Push `POST /iclock/cdata?table=user` | ~1s |
| **Cadastro de face** | Push `POST /iclock/cdata?table=biophoto` + `biodata` + `userpic` | ~1s |
| **Check-in de ponto** | Push `POST /iclock/cdata?table=rtlog` ou `table=ATTLOG` | Instantâneo |
| **Deleção de user** (menu do REP) | Push OPERLOG → backend enfileira `DATA QUERY user` → prune | ~10s |
| **Config admin** (menu do REP) | Push OPERLOG → resync | ~10s |
| **Fotos existentes no REP** | Backend enfileira `DATA QUERY tablename=biophoto,filter=Type=9` a cada registry + a cada 5min | até 5min |
| **Reboot do REP** | Registry dispara `queueInitialCommands` (sync users + biophotos + reaplica config) | 30s |

O dashboard reflete em tempo real via WebSocket (`users_updated`, `new_log`, `device_update`, `command_result`).

---

## Estrutura do repositório

```text
zekateco-web/
├── server.ts                    # backend Express single-file
├── prisma/schema.prisma         # schema MySQL
├── src/                         # frontend React
│   ├── components/
│   ├── screens/                 # HomeScreen, RealtimeScreen, DispositivoScreen, etc
│   └── state/
├── docker-compose.yml
├── docker/
│   ├── backend/                 # Dockerfile + entrypoint (roda prisma db push)
│   └── frontend/                # Dockerfile + nginx.conf (gateway ADMS)
├── terraform/                   # infra (SSH key, firewall, DNS)
│   └── README.md
├── deploy/                      # scripts de deploy manual
│   ├── deploy.sh
│   └── README.md
├── .github/
│   ├── workflows/               # CI + Terraform plan/apply + deploy
│   └── README.md
├── photos/                      # storage local de fotos (também vai pro S3)
└── docs/
    ├── CLAUDE.md                # notas pra IA + regras críticas
    ├── USERS_SYNC_PROTOCOL.md
    ├── photo-sync-protocol.md
    └── deploy-ec2.md            # deploy alternativo (histórico)
```

---

## Documentação relacionada

- [`docs/CLAUDE.md`](docs/CLAUDE.md) — notas técnicas + regras de segurança sobre infra compartilhada
- [`terraform/README.md`](terraform/README.md) — como rodar Terraform local + backends remotos
- [`deploy/README.md`](deploy/README.md) — scripts de deploy manual como fallback
- [`.github/README.md`](.github/README.md) — detalhes dos workflows GitHub Actions
- [Jira DEV-157](https://soltech.atlassian.net/browse/DEV-157) — task de deploy inicial (2026-07-04) com passo a passo de reprodução em outros projetos

---

## Contatos e suporte

- Owner: [@jose-cleiton](https://github.com/jose-cleiton) — <cleitons835@gmail.com>
- Time: UltraSistech
- Board Jira: [soltech.atlassian.net/DEV](https://soltech.atlassian.net/jira/software/projects/DEV/boards/1)
