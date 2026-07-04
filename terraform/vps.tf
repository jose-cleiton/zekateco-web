# VPS zekateco-web.ultraponto (id 784010) — foi criada manualmente na Hostinger
# e renomeada via API. Terraform NÃO cria nem destrói VPS — apenas referencia
# via ID (var.vps_id) e gerencia firewall, chaves SSH e DNS.
#
# Isso protege contra apagão acidental. Se um dia precisar gerenciar o ciclo de
# vida da VPS via Terraform, importa com:
#   terraform import hostinger_vps.zekateco 784010
#
# ATENÇÃO: outras 3 VPS existentes na conta NÃO SÃO gerenciadas por esse Terraform:
#   VPS-API-2.ultraponto  (id 1451747, 187.77.1.162) — produção Ultraponto
#   VPS-DB.ultraponto     (id 1668455, 72.62.173.226) — produção Ultraponto
#   VPS.UltraCRM          (id 922006, 31.97.165.88)  — produção UltraCRM
