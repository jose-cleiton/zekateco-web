# Deploy zekateco-web na EC2

## Contexto

O zekateco-web roda numa instância EC2 compartilhada com o Soltech (ultraponto-api).
Os dois projetos usam a mesma rede Docker `soltech_db_network`, que permite o nginx do
zekateco-web resolver `ultraponto-api` por DNS e fazer o mirror de tráfego ADMS do REP ZKTeco.

---

## Fase 1 — Instalar Docker + Compose plugin (Ubuntu/Debian)

```bash
sudo apt-get update -qq
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -qq
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
```

---

## Fase 2 — Clonar o repositório (se ainda não clonou)

```bash
# Gerar deploy key e adicionar ao GitHub
ssh-keygen -t ed25519 -C "ec2-zekateco-web" -f ~/.ssh/id_ed25519_zekateco -N ""
cat ~/.ssh/id_ed25519_zekateco.pub
# Copiar a saída e adicionar em:
# GitHub → jose-cleiton/zekateco-web → Settings → Deploy keys → Add deploy key

cat >> ~/.ssh/config <<'EOF'
Host github-zekateco
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_zekateco
EOF

git clone -b rodar-servidor git@github-zekateco:jose-cleiton/zekateco-web.git ~/zekateco-web
cd ~/zekateco-web
```

---

## Fase 3 — Configurar o `.env`

```bash
cat > ~/zekateco-web/.env <<'EOF'
MYSQL_ROOT_PASSWORD=<senha-forte-root>
MYSQL_DATABASE=zekateco
MYSQL_USER=zekateco
MYSQL_PASSWORD=<senha-forte-app>
EOF
chmod 600 ~/zekateco-web/.env
```

| Variável              | Observação                              |
|-----------------------|-----------------------------------------|
| `MYSQL_ROOT_PASSWORD` | Senha forte, nunca exposta externamente |
| `MYSQL_DATABASE`      | Fixo: `zekateco`                        |
| `MYSQL_USER`          | Fixo: `zekateco`                        |
| `MYSQL_PASSWORD`      | Senha forte                             |

`DATABASE_URL`, `PORT` e `NODE_ENV` são definidos automaticamente pelo `docker-compose.yml`.

---

## Fase 4 — Garantir a rede `soltech_db_network`

O Soltech precisa estar de pé (ele cria a rede). Verificar:

```bash
docker network ls | grep soltech_db_network
```

Se a rede não existir ainda:
```bash
docker network create soltech_db_network
# Quando o Soltech subir, ele se conecta à rede existente automaticamente.
```

---

## Fase 5 — Build e subida

```bash
cd ~/zekateco-web
docker compose up -d --build
docker compose logs -f --tail=50
```

---

## Verificação

```bash
# Todos os containers rodando?
docker compose ps

# Dashboard (porta 80)
curl -s -o /dev/null -w "%{http_code}" http://localhost/

# Gateway ADMS (porta 8080)
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/

# Backend interno
docker compose exec frontend wget -qO- http://backend:3000/ 2>/dev/null | head -5
```

**Security groups EC2 — inbound rules necessárias:**

| Porta | Protocolo | Origem                  |
|-------|-----------|-------------------------|
| 22    | TCP       | Seu IP                  |
| 80    | TCP       | 0.0.0.0/0               |
| 8080  | TCP       | IPs dos REPs ZKTeco     |

---

## Atualizações futuras

```bash
cd ~/zekateco-web
git pull origin rodar-servidor
docker compose up -d --build
```

---

## Arquivos críticos

| Arquivo                        | O que faz                                              |
|--------------------------------|--------------------------------------------------------|
| `docker-compose.yml`           | Define os 3 serviços e as redes                        |
| `docker/backend/Dockerfile`    | Build do backend Node/Prisma                           |
| `docker/frontend/Dockerfile`   | Build do SPA + nginx                                   |
| `docker/frontend/nginx.conf`   | Roteamento :80 (dashboard) e :8080 (mirror gateway)    |
| `docker/backend/entrypoint.sh` | Aplica `prisma db push` e inicia o servidor            |
| `.env`                         | Criado na EC2, **nunca commitar** — credenciais MySQL  |
