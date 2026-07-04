output "vps_id" {
  value       = var.vps_id
  description = "ID do VPS gerenciado"
}

output "vps_ip" {
  value       = var.vps_ip
  description = "IP público do VPS"
}

output "ssh_key_id" {
  value       = hostinger_vps_ssh_key.cleitons835.id
  description = "ID da chave SSH cadastrada na conta"
}

output "dashboard_url" {
  value       = var.domain != "" ? "https://${var.subdomain}.${var.domain}" : "http://${var.vps_ip}:81"
  description = "URL do dashboard zekateco-web"
}

output "adms_gateway_url" {
  value       = var.domain != "" ? "http://${var.subdomain}.${var.domain}:8090" : "http://${var.vps_ip}:8090"
  description = "Endereço que os REPs ZKTeco devem apontar"
}

output "next_steps" {
  value = <<-EOT

    Firewall e chave SSH provisionados. Agora:

    1. Teste SSH:
       ssh root@${var.vps_ip}

    2. Instale Docker no VPS (primeira vez apenas):
       bash deploy/deploy.sh   # ou o script de instalação Docker

    3. Configure DNS (se ainda não tiver):
       - Edite terraform.tfvars descomentando 'domain' e 'subdomain'
       - Rode: terraform apply
  EOT
}
