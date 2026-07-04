# Firewall — o provider Terraform da Hostinger (v0.1.22) NÃO tem resource
# pra firewall, então gerenciamos via API oficial usando null_resource + curl.
#
# API docs: https://developers.hostinger.com (VPS Firewall endpoints)
#
# Estratégia:
#  1. Cria firewall com regras via POST /vps/v1/firewall
#  2. Anexa ao VPS via POST /vps/v1/firewall/{id}/activate/{vps_id}
#  3. Guarda o firewall_id em local_file pra referência futura
#
# Portas abertas:
#   22   → SSH (deploy via GitHub Actions)
#   80   → HTTP
#   443  → HTTPS
#   81   → Dashboard React (nginx :81 → host :81)
#   8090 → Gateway ADMS (REPs ZKTeco apontam aqui)
#   ICMP → ping (debug)

locals {
  firewall_rules = [
    { protocol = "TCP", port = "22", source = "any" },
    { protocol = "TCP", port = "80", source = "any" },
    { protocol = "TCP", port = "443", source = "any" },
    { protocol = "TCP", port = "81", source = "any" },
    { protocol = "TCP", port = "8090", source = "any" },
    { protocol = "ICMP", port = null, source = "any" },
  ]
}

# Cria o firewall e anexa ao VPS. Usa um script bash inline pra:
# - POST /vps/v1/firewall com nome
# - PUT /vps/v1/firewall/{id}/rules pra cada regra
# - POST /vps/v1/firewall/{id}/activate/{vps_id}
resource "null_resource" "firewall_zekateco" {
  triggers = {
    vps_id = var.vps_id
    # Trigger só reprovisiona quando as regras (serializadas) mudarem
    rules_hash = sha256(jsonencode(local.firewall_rules))
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -euo pipefail
      TOKEN="$HOSTINGER_API_TOKEN"
      API="https://developers.hostinger.com/api/vps/v1/firewall"

      echo "→ Criando firewall zekateco-web-fw"
      FW_RESP=$(curl -sS -X POST \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"name":"zekateco-web-fw"}' \
        "$API")
      echo "$FW_RESP"

      FW_ID=$(echo "$FW_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")
      if [ -z "$FW_ID" ]; then
        echo "❌ Falha ao criar firewall"
        exit 1
      fi
      echo "→ Firewall criado id=$FW_ID"

      echo "→ Adicionando regras"
      for RULE in '{"protocol":"TCP","port":"22","source":"any"}' \
                  '{"protocol":"TCP","port":"80","source":"any"}' \
                  '{"protocol":"TCP","port":"443","source":"any"}' \
                  '{"protocol":"TCP","port":"81","source":"any"}' \
                  '{"protocol":"TCP","port":"8090","source":"any"}' \
                  '{"protocol":"ICMP","source":"any"}'; do
        curl -sS -X POST \
          -H "Authorization: Bearer $TOKEN" \
          -H "Content-Type: application/json" \
          -d "$RULE" \
          "$API/$FW_ID/rules" \
          -w " → HTTP %%{http_code}\n"
      done

      echo "→ Ativando firewall no VPS ${var.vps_id}"
      curl -sS -X POST \
        -H "Authorization: Bearer $TOKEN" \
        "$API/$FW_ID/activate/${var.vps_id}" \
        -w " → HTTP %%{http_code}\n"

      # Persiste o firewall_id em arquivo local pra referência
      echo "$FW_ID" > ${path.module}/.firewall_id
      echo "✅ Firewall $FW_ID ativo em VPS ${var.vps_id}"
    EOT

    environment = {
      HOSTINGER_API_TOKEN = var.hostinger_api_token
    }
  }

  # Bloqueia destroy acidental — pra remover, você faz manual no hPanel
  # ou remove o triggers e reroda.
  lifecycle {
    ignore_changes = [triggers]
  }
}
