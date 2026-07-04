# Terraform — zekateco-web

Gerencia a infraestrutura do VPS `srv784010.hstgr.cloud` (Hostinger) via API oficial.

## O que é gerenciado

- Firewall (portas 22, 80, 443, 81, 8090, ICMP)
- Chave SSH cadastrada no VPS
- DNS (opcional — só se `var.domain` for preenchida)

## O que NÃO é gerenciado

- **VPS em si** — usamos referência por ID (`var.vps_id = 784010`); Terraform NUNCA vai criar ou destruir a VPS
- **Deploy da aplicação** — feito por `.github/workflows/deploy.yml` (SSH + `docker compose`)
- **Backups/snapshots** — configurar manualmente no hPanel
- **Outras 3 VPS** da conta (`VPS-API-2`, `VPS-DB`, `UltraCRM`) — não referenciadas em lugar nenhum

## Rodar localmente

```bash
# 1. Token da Hostinger via env var (nunca commitado)
export TF_VAR_hostinger_api_token="$HOSTINGER_API_TOKEN"

# 2. Copia o template e ajusta se precisar
cp terraform.tfvars.example terraform.tfvars

# 3. Inicializa (baixa provider)
terraform init

# 4. Valida sintaxe
terraform validate

# 5. Confere o que vai mudar SEM aplicar
terraform plan

# 6. Aplica após revisar o plan
terraform apply
```

## Fluxo Git (recomendado)

1. **Criar branch** — `git switch -c feat/terraform-ajuste`
2. **Editar arquivos** em `terraform/`
3. **Push + PR** contra `main`
4. **GitHub Actions** roda automaticamente:
   - `terraform fmt -check`
   - `terraform validate`
   - `terraform plan` → resultado comentado no PR
5. **Revisar o plan no PR** — se algum recurso está sendo destruído inesperadamente, refuse o merge
6. **Merge no `main`** — dispara `terraform-apply.yml`
7. **Approval manual** via GitHub Environment "production" (configurar em Settings → Environments)
8. **Apply automático** após aprovação

## State

Por padrão, state fica local em `terraform.tfstate` (protegido pelo `.gitignore`).

Pra produção, migrar pra remote (evita perda de state e permite trabalho em equipe):

- **Terraform Cloud** (free até 5 usuários): https://app.terraform.io — descomentar bloco `backend "remote"` em `main.tf`
- **S3** — bucket versionado + DynamoDB pra lock

## Recursos gerenciados

| Arquivo | Recurso |
|---|---|
| `firewall.tf` | `hostinger_vps_firewall` + attachment |
| `ssh_key.tf` | `hostinger_vps_public_key` + attachment |
| `dns.tf` | `hostinger_dns_record` (opcional) |
| `vps.tf` | Só comentário — VPS referenciada por ID |

## Debug

Se `terraform init` falhar dizendo que o provider não existe:

```bash
# Confere no registry
terraform providers
# Deve listar: hostinger/hostinger

# Nome dos resources: consulte docs oficiais
# https://registry.terraform.io/providers/hostinger/hostinger/latest/docs
```

Se algum nome de resource não existir (o provider é novo e pode ter mudado), ajuste em `firewall.tf`/`ssh_key.tf`/`dns.tf` conforme documentação atual.

## Segurança

- Token Hostinger só via env var `TF_VAR_hostinger_api_token`
- `prevent_destroy = true` em firewall e chave SSH → bloqueia destroy acidental
- `.tfvars` gitignored
- Chave SSH **privada** nunca aqui — só a pública
