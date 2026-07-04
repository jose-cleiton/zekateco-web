# GitHub Actions — zekateco-web

## Fluxo de deploy end-to-end

```
1. Você em branch local
   git switch -c feat/nova-funcionalidade
   git commit -am "..."
   git push -u origin feat/nova-funcionalidade

2. Abre PR contra main
   → ci.yml roda: type-check + docker build (dry run)
   → terraform-plan.yml roda (se mexeu em terraform/)
     Comenta no PR o plan completo com diff dos recursos

3. Você revisa o PR + comentário do plan
   → aprova + merge

4. Após merge em main:
   → terraform-apply.yml (se mexeu em terraform/)
     Aguarda approval manual no GitHub Environments
     Aplica infra na Hostinger
   → deploy.yml (se mexeu em código da app)
     Aguarda approval manual
     SSH no VPS + docker compose up -d --build
     Health check em :81 (dashboard) e :8090 (ADMS gateway)
```

## Configuração inicial

### 1. Secrets do repositório

Vá em `Settings → Secrets and variables → Actions → Repository secrets` e crie:

- `HOSTINGER_API_TOKEN` — token gerado no hPanel (developers.hostinger.com)
- `SSH_PUBLIC_KEY` — conteúdo de `~/.ssh/id_ed25519.pub`
- `VPS_SSH_PRIVATE_KEY` — conteúdo completo de `~/.ssh/id_ed25519` (inclui BEGIN/END)

### 2. Environment "production"

`Settings → Environments → New environment → production`:

- Marque **Required reviewers** e adicione você mesmo
- (Opcional) **Deployment branches** → só `main`

Isso pausa cada deploy aguardando aprovação manual — evita apply/deploy acidental.

### 3. Branch protection na main

`Settings → Branches → Add rule → main`:

- ☑️ Require a pull request before merging
- ☑️ Require status checks to pass — marca `CI / typecheck`, `CI / docker-build`, `Terraform Plan / plan`
- ☑️ Require conversation resolution
- ☑️ Do not allow bypassing the above

Assim, ninguém consegue commitar direto na main — todo deploy passa por PR + reviews.

### 4. Preparar o VPS pro primeiro deploy

Uma vez, manualmente:

```bash
ssh root@2.25.208.124 <<'EOF'
apt-get update
apt-get install -y docker.io docker-compose-plugin git curl
systemctl enable --now docker
EOF
```

Depois disso, o próprio `deploy.yml` faz `git clone` na primeira execução.

## Workflows

| Arquivo | Trigger | O que faz |
|---|---|---|
| `ci.yml` | PR | Type-check TypeScript + docker build (backend + frontend) |
| `terraform-plan.yml` | PR em `terraform/**` | `fmt` + `init` + `validate` + `plan` → comenta no PR |
| `terraform-apply.yml` | Push em `main` em `terraform/**` | `apply` na Hostinger (approval manual) |
| `deploy.yml` | Push em `main` (código da app) | SSH deploy + health check (approval manual) |

## Troubleshooting

**Plan falha no PR** — geralmente é secret faltando (`HOSTINGER_API_TOKEN` ou `SSH_PUBLIC_KEY`) ou nome de resource errado no provider Hostinger. Ver logs do workflow em Actions.

**Deploy trava aguardando approval** — vá em Actions → Deployments → clique no job pausado → **Review deployments** → Approve.

**Health check falha após deploy** — SSH no VPS e roda `docker compose logs backend | tail -50` pra ver o que quebrou. Rollback com `git revert` + `git push`.
