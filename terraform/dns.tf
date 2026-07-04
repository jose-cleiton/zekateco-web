# DNS — só aplica quando var.domain estiver preenchido.
# Aponta <subdomain>.<domain> → var.vps_ip via record A.

resource "hostinger_dns_record" "zekateco_a" {
  count = var.domain != "" ? 1 : 0

  zone  = var.domain
  name  = var.subdomain
  type  = "A"
  value = var.vps_ip
  ttl   = 300
}

# IPv6 opcional — descomente e ajuste o IP se quiser.
# resource "hostinger_dns_record" "zekateco_aaaa" {
#   count = var.domain != "" ? 1 : 0
#
#   zone  = var.domain
#   name  = var.subdomain
#   type  = "AAAA"
#   value = "2a02:4780:75:4bda::1"
#   ttl   = 300
# }
