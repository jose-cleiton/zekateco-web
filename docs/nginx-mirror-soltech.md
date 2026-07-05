# Mirror ADMS no Soltech (VPS `72.62.173.226`) → zekateco-web

Configura o nginx do Soltech (que serve o vhost `api.ultraponto.ultrasistech.com.br`)
para espelhar cada request ADMS dos REPs para o zekateco-web. Zero mudança no
código do Soltech, ativação via `nginx -s reload`.

## Arquitetura

```
REP → api.ultraponto.ultrasistech.com.br:8080 (DNS → 72.62.173.226)
      │
      ▼
  nginx Soltech :8080 (vhost api.ultraponto...)
      ├─► proxy_pass → backend Soltech    (resposta ao REP, sem mudança)
      └─► mirror /__mirror_zekateco → HTTP 2.25.208.124:81/__mirror/iclock/*
                                       (subrequest fire-and-forget)
```

- **REPs não são reconfigurados** — continuam apontando pra `api.ultraponto...`
- **Soltech continua o master** (responde ao REP, gera comandos, processa)
- **Zekateco-web recebe cópia** só pra dashboard, sem interferir no ponto

## Requisitos (já prontos do lado zekateco-web)

- ✅ Endpoint `/__mirror/iclock/*` no server :80 do container frontend do zekateco-web
- ✅ Backend valida `X-Mirror-Secret`
- ✅ `MIRROR_SECRET` no `.env` do zekateco-web em `srv784010` (2.25.208.124)
- ✅ Porta 81 do host aberta no firewall Hostinger

**Valor do secret compartilhado**:
```
0789d655b3d7c22efda45d8d91abd9c7ccb3d1260a05ec4e3b961a75e5e1bf25
```

## Snippet nginx pra colar na VPS do Soltech (`72.62.173.226`)

Localizar o arquivo do vhost que serve `api.ultraponto.ultrasistech.com.br`
na porta 8080. Provavelmente em `/etc/nginx/sites-available/` ou
`/etc/nginx/conf.d/`. Dentro do `server { listen 8080; server_name api.ultraponto...; }`:

```nginx
# ============================================================================
# Mirror ADMS → zekateco-web (fire-and-forget)
# Copia todo request ADMS dos REPs pra alimentar o dashboard do suporte.
# Zero impacto no fluxo REP → Soltech (subrequest paralela, resposta descartada).
#
# Kill switch: comentar `mirror /__mirror_zekateco;` + nginx -s reload
# ============================================================================

# --- Adicionar dentro do location /iclock/ existente ---
# NÃO mexer no proxy_pass existente pro backend Soltech. Só adicionar UMA linha:
location /iclock/ {
    mirror /__mirror_zekateco;                # ← ADICIONAR
    # ... proxy_pass existente pro backend Soltech, inalterado ...
}

# --- Adicionar como um novo location no mesmo server block ---
# Subrequest interna: envia cópia pro zekateco-web. Não acessível de fora.
location = /__mirror_zekateco {
    internal;

    # Vai direto pelo IP pra evitar dependência de DNS externo pra rota interna.
    # Path completo: /__mirror + URI original (ex: /iclock/cdata?SN=X&table=rtlog).
    proxy_pass http://2.25.208.124:81/__mirror$request_uri;

    proxy_set_header X-Mirror-Secret "0789d655b3d7c22efda45d8d91abd9c7ccb3d1260a05ec4e3b961a75e5e1bf25";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Host 2.25.208.124;

    # Timeouts curtos — se o zekateco-web tiver algum problema, não atrapalha
    # o fluxo primário (mas na prática a subrequest do mirror já é fire-and-forget).
    proxy_connect_timeout 3s;
    proxy_read_timeout 3s;
    proxy_ignore_client_abort on;
    proxy_next_upstream off;
}
```

**Sobre `client_max_body_size`**: garantir que o server block já tenha
`client_max_body_size 20m;` ou similar — biophoto uploads podem ser grandes.

## Passos de ativação (na VPS do Soltech `72.62.173.226`)

```bash
# 1. Editar o vhost do api.ultraponto...
sudo vim /etc/nginx/sites-available/api.ultraponto     # (ou onde estiver)

# 2. Colar o snippet acima. Manter proxy_pass existente do location /iclock/,
#    só adicionar a linha `mirror /__mirror_zekateco;` dentro dele.

# 3. Validar sintaxe
sudo nginx -t

# 4. Aplicar sem downtime
sudo nginx -s reload

# 5. Testar do PRÓPRIO Soltech se ele consegue chegar no zekateco-web
curl -s -o /dev/null -w "HTTP %{http_code}\n" \
  -X POST "http://2.25.208.124:81/__mirror/iclock/cdata?SN=TESTE&table=rtlog" \
  -H "X-Mirror-Secret: 0789d655b3d7c22efda45d8d91abd9c7ccb3d1260a05ec4e3b961a75e5e1bf25" \
  -H "X-Forwarded-For: 1.2.3.4" \
  -H "Content-Type: text/plain" \
  --data "pin=1 time=2026-07-04 23:00:00 status=0 verify=15"
# Esperado: HTTP 200
```

## Validação end-to-end

Depois de ativar o snippet + fazer uma batida num REP real:

```bash
# Do seu laptop
dig api.ultraponto.ultrasistech.com.br +short          # → 72.62.173.226 (Soltech)
curl -s http://2.25.208.124:81/api/devices | jq        # deve mostrar VDE2252800062 online
```

**Sinais de que está funcionando**:
- REP aparece **Online** no dashboard `http://2.25.208.124:81`
- Batidas chegam em Registros em Tempo Real ao vivo
- Contadores no UltraPonto continuam batendo normalmente (Soltech intacto)

## Kill switch (se algo der errado)

Na VPS do Soltech:

```bash
sudo sed -i 's|^    mirror /__mirror_zekateco;|    # mirror /__mirror_zekateco;  # DISABLED|' \
  /etc/nginx/sites-available/api.ultraponto
sudo nginx -s reload
```

REPs param de aparecer no dashboard. Soltech nunca soube da diferença.

## Notas técnicas

- **`getrequest`/`devicecmd` também são espelhados**: seguro porque o endpoint
  `/__mirror/iclock/getrequest|devicecmd` no zekateco-web retorna 204 sem
  consumir comando da fila (defesa em profundidade).
- **`mirror_request_body on`** é o default → payload byte a byte.
- **HTTP entre VPSs**: se preferir HTTPS, gerar cert pra `2.25.208.124` (ou usar
  domínio próprio + Let's Encrypt) e trocar `http://` por `https://` no
  `proxy_pass`. Por ora, HTTP com `X-Mirror-Secret` já garante que só quem tem o
  segredo consegue mandar dados.
- **Firewall**: a porta 81 do host `2.25.208.124` já está aberta no firewall
  Hostinger (foi liberada anteriormente pra deploy do dashboard).

## Se ainda quiser desligar tudo do lado zekateco-web

```bash
ssh root@2.25.208.124
cd /opt/zekateco-web
# Esvaziar o secret → /__mirror retorna 401 pra tudo
sed -i 's/^MIRROR_SECRET=.*/MIRROR_SECRET=/' .env
docker compose up -d backend
```
