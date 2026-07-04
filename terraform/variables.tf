variable "hostinger_api_token" {
  type        = string
  sensitive   = true
  description = "Token da Hostinger API. Passar via env var TF_VAR_hostinger_api_token — NUNCA colocar em .tfvars commitado."
}

variable "vps_id" {
  type        = number
  default     = 784010
  description = "ID do VPS zekateco-web.ultraponto (id 784010) na Hostinger."
}

variable "vps_hostname" {
  type        = string
  default     = "zekateco-web.ultraponto"
  description = "Hostname do VPS gerenciado."
}

variable "vps_ip" {
  type        = string
  default     = "2.25.208.124"
  description = "IP público do VPS (usado em outputs, health checks e DNS)."
}

variable "ssh_public_key" {
  type        = string
  description = "Chave SSH pública (ed25519 recomendado) com acesso ao VPS."
}

variable "ssh_key_name" {
  type        = string
  default     = "cleitons835-ed25519"
  description = "Nome identificador da chave SSH no painel Hostinger."
}

variable "allowed_rep_ips" {
  type        = list(string)
  default     = ["0.0.0.0/0"]
  description = "IPs permitidos no gateway ADMS (porta 8090). Deixe aberto até saber IPs fixos dos REPs, depois restrinja."
}

variable "domain" {
  type        = string
  default     = ""
  description = "Domínio raiz gerenciado na Hostinger (ex: ultrasistech.com.br). Vazio = não configura DNS."
}

variable "subdomain" {
  type        = string
  default     = "zekateco"
  description = "Subdomínio pra apontar pro VPS (ex: 'zekateco' → zekateco.<domain>)."
}
