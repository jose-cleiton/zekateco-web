terraform {
  required_version = ">= 1.6.0"

  required_providers {
    hostinger = {
      source  = "hostinger/hostinger"
      version = "~> 0.1"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.2"
    }
  }

  # State remoto no S3 — mesmo bucket que já usamos pra fotos biométricas.
  # Bucket tem versioning ligado (rollback automático se state corromper).
  # Sem DynamoDB lock (IAM restrito) — evitar rodar apply concorrente.
  # Credenciais AWS via env vars (TF_VAR_hostinger_api_token já vem do shell;
  # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION também).
  backend "s3" {
    bucket  = "ultraponto-varejo"
    key     = "terraform/zekateco-web.tfstate"
    region  = "us-east-1"
    encrypt = true
  }
}

provider "hostinger" {
  api_token = var.hostinger_api_token
}
