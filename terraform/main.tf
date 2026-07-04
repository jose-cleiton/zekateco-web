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

  # Backend local por simplicidade. Pra produção séria, migrar pra remote:
  # - Terraform Cloud (free): app.terraform.io
  # - S3 + DynamoDB pra lock
  # backend "remote" {
  #   organization = "sua-org"
  #   workspaces { name = "zekateco-web" }
  # }
}

provider "hostinger" {
  api_token = var.hostinger_api_token
}
