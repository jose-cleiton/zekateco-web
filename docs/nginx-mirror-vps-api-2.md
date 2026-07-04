# Mirror ADMS na VPS-API-2 (Soltech)

Como configurar o nginx da VPS-API-2 (Soltech) pra espelhar as requests ADMS
dos REPs pro zekateco-web. Aborda gem baseada na directive `mirror` do nginx —
zero mudança no código do Soltech, ativação via `nginx -s reload`.

## Arquitetura

```
REP → nginx VPS-API-2 :8080
      ├─► proxy_pass → Soltech container (RESPOSTA vai daqui pro REP)
      └─► mirror /__mirror_zekateco → HTTPS zekateco.ultraponto.com/__mirror/iclock/*
                                       (subrequest fire-and-forget)
```

O nginx `mirror` faz um "tee" da request: envia cópia (headers + body) pro
segundo destino em paralelo, sem esperar resposta nem bloquear o cliente.
Latência pro REP: 0ms.

## Requisitos

1. `MIRROR_SECRET` definido no `.env` do zekateco-web em `srv784010` (já feito).
2. Endpoint `/__mirror/iclock/*` no zekateco-web já responde (PR #12).
3. Acesso ao nginx.conf da VPS-API-2.

## Snippet nginx

Adicionar dentro do `server { listen 8080; ... }` que recebe `/iclock/*` do REP.

```nginx
# ============================================================================
# Mirror ADMS → zekateco-web dashboard (fire-and-forget)
# Kill switch: comentar a linha `mirror /__mirror_zekateco;` + nginx -s reload
# ============================================================================

# Shared secret — MESMO valor de MIRROR_SECRET no .env do zekateco-web srv784010
# Gerar com: openssl rand -hex 32
set $zekateco_mirror_secret "REPLACE_COM_O_VALOR_DO_SECRET";

# --- Ativar mirror no location existente do /iclock/ ---
# NÃO precisa mexer no proxy_pass existente. Adicionar SÓ esta linha:
#   mirror /__mirror_zekateco;

location /iclock/ {
    mirror /__mirror_zekateco;                # ← ADICIONAR
    # ... resto do location inalterado (proxy_pass pro container Soltech) ...
}

# --- Subrequest interna: envia cópia pro zekateco-web ---
location = /__mirror_zekateco {
    internal;                                 # não acessível de fora
    resolver 8.8.8.8 valid=300s;
    resolver_timeout 5s;

    # Constrói a URL de destino preservando path + query original.
    # Ex: /iclock/cdata?SN=X&table=rtlog → /__mirror/iclock/cdata?SN=X&table=rtlog
    proxy_pass https://zekateco.ultraponto.com/__mirror$request_uri;

    proxy_set_header X-Mirror-Secret $zekateco_mirror_secret;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Host zekateco.ultraponto.com;

    proxy_connect_timeout 3s;
    proxy_read_timeout 3s;
    proxy_ignore_client_abort on;

    # Nunca deixar erro do mirror afetar a resposta ao REP
    proxy_next_upstream off;
}
```

## Passos de ativação

Executar na VPS-API-2 como root (ou usuário com perms de nginx):

```bash
# 1. Ler o secret gerado no zekateco-web
ssh root@srv784010.zekateco 'grep MIRROR_SECRET /opt/zekateco-web/.env'
# copia o valor, ex: 0789d655b3d7c22efda45d8d91abd9c7ccb3d1260a05ec4e3b961a75e5e1bf25

# 2. Editar o nginx.conf da VPS-API-2 aplicando o snippet acima
sudo nano /etc/nginx/sites-available/soltech   # (ou onde estiver)

# 3. Substituir "REPLACE_COM_O_VALOR_DO_SECRET" pelo valor real

# 4. Validar config
sudo nginx -t

# 5. Reload
sudo nginx -s reload
```

## Testes pós-ativação

Do próprio nginx da VPS-API-2 (ou de qualquer lugar com acesso à internet):

```bash
# 1. Simular request ADMS (batida) no gateway Soltech
curl -X POST "http://<IP-VPS-API-2>:8080/iclock/cdata?SN=TESTE_MIRROR_A&table=rtlog" \
  -H "Content-Type: text/plain" \
  --data "pin=8888 time=2026-07-04 23:00:00 status=0 verify=15"

# 2. Verificar que zekateco-web recebeu (via /api/devices/by-ip)
curl -s "https://zekateco.ultraponto.com/api/devices/by-ip/<seu-ip-de-teste>"
# Deve retornar array com o SN TESTE_MIRROR_A

# 3. Verificar log de erro do nginx da VPS-API-2 (não deve ter erros do mirror)
sudo tail -f /var/log/nginx/error.log | grep -i mirror
```

## Kill switch

Se algo der errado:

```bash
# 1. Comentar a linha `mirror /__mirror_zekateco;` no nginx.conf
# 2. sudo nginx -s reload
```

Nenhum tráfego pro zekateco-web. Comportamento volta idêntico ao anterior.
Nada é perdido do lado do Soltech — ele nunca dependeu do zekateco-web.

## Notas técnicas

- **`getrequest`/`devicecmd` também são espelhados**: seguro porque o endpoint
  `/__mirror/iclock/getrequest|devicecmd` no zekateco-web retorna 204 sem
  consumir comando da fila (defesa em profundidade).
- **`mirror_request_body on`** é o default → payload byte a byte.
- **client_max_body_size**: garantir ≥ 10MB no server block (biophoto é grande).
- **HTTPS pra zekateco-web**: obrigatório pra evitar vazamento do
  `X-Mirror-Secret` em texto claro.
- **Se HTTPS não estiver disponível ainda**: usar HTTP + firewall na VPS-API-2
  restringindo destino, ou colocar os dois containers na mesma rede Docker
  compartilhada (`http://zekateco-backend:3000/__mirror`).

## Rollback do lado zekateco-web

Se precisar desligar totalmente do lado zekateco-web (sem tocar VPS-API-2):

```bash
ssh root@srv784010.zekateco
cd /opt/zekateco-web
# 1. Esvaziar secret → endpoint retorna 401 pra tudo
sed -i 's/^MIRROR_SECRET=.*/MIRROR_SECRET=/' .env
# 2. Restart
docker compose up -d backend
```

Simetricamente, `READ_ONLY=0` restaura permissões de escrita no dashboard.
