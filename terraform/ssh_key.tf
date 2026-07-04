# Cadastra a chave SSH na conta Hostinger.
# O provider v0.1.22 cria a chave mas NÃO tem attach a VPS existente —
# então anexamos via API oficial usando null_resource + curl.

resource "hostinger_vps_ssh_key" "cleitons835" {
  name = var.ssh_key_name
  key  = var.ssh_public_key

  lifecycle {
    prevent_destroy = true
  }
}

# Anexa a chave SSH ao VPS existente via API Hostinger.
# Trigger dispara reprovisiona quando a key_id mudar.
resource "null_resource" "attach_ssh_key" {
  triggers = {
    ssh_key_id = hostinger_vps_ssh_key.cleitons835.id
    vps_id     = var.vps_id
  }

  provisioner "local-exec" {
    command = <<-EOT
      curl -sS -X POST \
        -H "Authorization: Bearer $HOSTINGER_API_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"ids": [${hostinger_vps_ssh_key.cleitons835.id}]}' \
        "https://developers.hostinger.com/api/vps/v1/virtual-machines/${var.vps_id}/public-keys/attach" \
        -w "\nHTTP %%{http_code}\n"
    EOT

    environment = {
      HOSTINGER_API_TOKEN = var.hostinger_api_token
    }
  }
}
