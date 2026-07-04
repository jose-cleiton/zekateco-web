# Deploy — zekateco-web

## Fluxo automatizado (via GitHub Actions)

O deploy padrão acontece **automaticamente** ao dar merge em `main`:

```
Você → branch feature/xxx → PR → main (após approval) → GH Actions → VPS
```

Workflows envolvidos:

| Workflow | Dispara | O que faz |
|---|---|---|
| `.github/workflows/ci.yml` | Todo PR (exceto só docs/terraform) | Type-check + `docker build` |
| `.github/workflows/terraform-plan.yml` | PR que mexe em `terraform/` | Comenta o `plan` no PR |
| `.github/workflows/terraform-apply.yml` | Merge em `main` (se `terraform/` mudou) | Aplica infra (com approval) |
| `.github/workflows/deploy.yml` | Merge em `main` (código da app) | SSH no VPS + `docker compose up -d --build` |

## Deploy manual

Se precisar fazer deploy fora do fluxo (hotfix urgente, branch específica, etc.):

```bash
# Deploy da main (padrão)
bash deploy/deploy.sh

# Deploy de uma branch específica
bash deploy/deploy.sh fix/urgent-bug

# Deploy em outro host (se testar em VPS alternativa)
VPS_HOST=1.2.3.4 bash deploy/deploy.sh
```

Requisitos:
- Chave SSH `~/.ssh/id_ed25519` com acesso root ao VPS
- Git + curl instalados localmente

## Secrets necessários no GitHub

Configurar em **Settings → Secrets and variables → Actions → Repository secrets**:

| Secret | Conteúdo | Onde usa |
|---|---|---|
| `HOSTINGER_API_TOKEN` | Token gerado no hPanel | `terraform-plan.yml`, `terraform-apply.yml` |
| `SSH_PUBLIC_KEY` | Sua chave pública (`~/.ssh/id_ed25519.pub`) | `terraform-plan.yml`, `terraform-apply.yml` |
| `VPS_SSH_PRIVATE_KEY` | Sua chave privada (`~/.ssh/id_ed25519`) | `deploy.yml` |

⚠️ **`VPS_SSH_PRIVATE_KEY`** é a chave **privada** completa, incluindo cabeçalho e rodapé:

```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXk...
...
-----END OPENSSH PRIVATE KEY-----
```

Colar exatamente assim no campo do secret (o GitHub aceita multiline).

## Environment "production" no GitHub

Pra ter **approval manual** antes de cada deploy:

1. GitHub → **Settings → Environments → New environment** → `production`
2. Marca **Required reviewers** e adiciona você mesmo (ou outros)
3. Opcional: **Deployment branches** → restringir a `main` só

Assim, quando o `terraform-apply` ou `deploy` for disparado, o job fica em pausa aguardando você clicar "Approve" no GitHub.

## Primeiro deploy

Antes do primeiro `deploy.yml` funcionar, o VPS precisa ter Docker instalado:

```bash
ssh root@2.25.208.124
apt-get update
apt-get install -y docker.io docker-compose-plugin git
systemctl enable --now docker
```

Depois, o próprio `deploy.yml` faz o `git clone` na primeira execução.

## Rollback

Se um deploy quebrar, você pode:

**a) Reverter o commit no Git** e deixar o Actions redeployar:

```bash
git revert <sha-do-commit-quebrado>
git push origin main
```

**b) Deploy manual de um commit antigo**:

```bash
ssh root@2.25.208.124
cd /opt/zekateco-web
git reset --hard <sha-anterior>
docker compose up -d --build
```

**c) Restaurar snapshot do VPS** (hPanel → Snapshots) — nuclear, perde qualquer dado gravado desde o snapshot.
