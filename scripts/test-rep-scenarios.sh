#!/usr/bin/env bash
# ==============================================================================
# Teste dos 4 cenários de tráfego REP → Soltech / Gateway.
# Simula o que cada REP faz dependendo de como está configurado hoje ou depois.
# Uso: bash scripts/test-rep-scenarios.sh
# ==============================================================================

set -uo pipefail

SOLTECH_IP="187.77.1.162"
GATEWAY_IP="2.25.208.124"
DOMAIN="api.ultraponto.ultrasistech.com.br"
PORT="8080"
DASH_PORT="81"
SN="SIMREP001"          # SN de teste (não bate no filtro IGNORED_SNS)
FAKE_REP_IP="203.0.113.42"  # IP público falso pra simular NAT do REP

# Cores pra saída
CY='\033[1;36m'; GR='\033[0;32m'; YL='\033[0;33m'; RD='\033[0;31m'; NC='\033[0m'

# HTTP timeout curto pra teste não travar
CURL="curl -s --max-time 8"

section() { echo -e "\n${CY}== $1 ==${NC}"; }
ok()      { echo -e "  ${GR}✓${NC} $*"; }
warn()    { echo -e "  ${YL}⚠${NC} $*"; }
fail()    { echo -e "  ${RD}✗${NC} $*"; }

http_code_ok() {
  # aceita 200/2xx OU 4xx (Soltech pode responder 400 sem SN, mas prova que rota está viva)
  local c="$1"
  [[ -n "$c" && "$c" != "000" && "$c" -lt 500 ]]
}

# ------------------------------------------------------------------------------
section "Cenário 1 — REP bate DIRETO no Soltech pelo IP público (situação atual)"
# ------------------------------------------------------------------------------
echo "  Simula: REP configurado com Server Address = $SOLTECH_IP, Port = $PORT"
echo "  Objetivo: baseline. Prova que a API do Soltech responde no /iclock/ping."
CODE=$($CURL -o /dev/null -w "%{http_code}" "http://$SOLTECH_IP:$PORT/iclock/ping?SN=$SN")
if http_code_ok "$CODE"; then
  ok "Soltech respondeu HTTP $CODE — API viva."
else
  fail "HTTP $CODE — Soltech não respondeu direto. Verificar rede do laptop → $SOLTECH_IP."
fi


# ------------------------------------------------------------------------------
section "Cenário 2 — REP bate no domínio ANTES do cutover (DNS ainda → Soltech)"
# ------------------------------------------------------------------------------
echo "  Simula: REP configurado com Server Address = $DOMAIN, Port = $PORT"
echo "          --resolve força ir pro Soltech (como o DNS atual faz)."
CODE=$($CURL -o /dev/null -w "%{http_code}" \
  --resolve "$DOMAIN:$PORT:$SOLTECH_IP" \
  "http://$DOMAIN:$PORT/iclock/ping?SN=$SN")
if http_code_ok "$CODE"; then
  ok "Domínio → Soltech: HTTP $CODE. Comportamento atual (pré-cutover) funcionando."
else
  fail "HTTP $CODE — domínio não chegou no Soltech."
fi


# ------------------------------------------------------------------------------
section "Cenário 3 — REP bate no domínio DEPOIS do cutover (DNS → Gateway 2.25.208.124)"
# ------------------------------------------------------------------------------
echo "  Simula: exatamente o que acontecerá quando o DNS mudar."
echo "          Gateway 2.25.208.124 → proxy pro Soltech + mirror pro dashboard."

# 3.1 - ping (rota simples)
CODE=$($CURL -o /dev/null -w "%{http_code}" \
  --resolve "$DOMAIN:$PORT:$GATEWAY_IP" \
  "http://$DOMAIN:$PORT/iclock/ping?SN=$SN")
if http_code_ok "$CODE"; then
  ok "Ping via gateway: HTTP $CODE."
else
  fail "Ping via gateway falhou: HTTP $CODE. O deploy do PR #16 pode não ter subido ainda."
fi

# 3.2 - cdata rtlog (batida)
CODE=$($CURL -o /dev/null -w "%{http_code}" -X POST \
  --resolve "$DOMAIN:$PORT:$GATEWAY_IP" \
  -H "Content-Type: text/plain" \
  -H "X-Forwarded-For: $FAKE_REP_IP" \
  --data "pin=9001 time=2026-07-04 23:30:00 status=0 verify=15" \
  "http://$DOMAIN:$PORT/iclock/cdata?SN=$SN&table=rtlog")
if http_code_ok "$CODE"; then
  ok "cdata (batida) via gateway: HTTP $CODE."
else
  fail "cdata via gateway falhou: HTTP $CODE."
fi

# 3.3 - getrequest (só Soltech pode responder — read-only por rede)
CODE=$($CURL -o /dev/null -w "%{http_code}" \
  --resolve "$DOMAIN:$PORT:$GATEWAY_IP" \
  "http://$DOMAIN:$PORT/iclock/getrequest?SN=$SN")
if http_code_ok "$CODE"; then
  ok "getrequest via gateway: HTTP $CODE (roteado pro Soltech)."
else
  fail "getrequest falhou: HTTP $CODE."
fi

# 3.4 - Aguardar mirror chegar no dashboard
sleep 2
if $CURL "http://$GATEWAY_IP:$DASH_PORT/api/devices/by-ip/$FAKE_REP_IP" | grep -q "$SN"; then
  ok "Mirror funcionou: SIMREP001 apareceu no dashboard com IP $FAKE_REP_IP."
else
  warn "Device ainda não visível pelo /api/devices/by-ip. Pode ser latência do mirror ou o SN não foi persistido."
fi


# ------------------------------------------------------------------------------
section "Cenário 4 — REP reconfigurado pro IP do Gateway direto (sem DNS)"
# ------------------------------------------------------------------------------
echo "  Simula: REP com Server Address = $GATEWAY_IP, Port = $PORT."
echo "          Útil se você quiser converter um REP de teste sem mexer no DNS."
CODE=$($CURL -o /dev/null -w "%{http_code}" \
  -H "X-Forwarded-For: $FAKE_REP_IP" \
  "http://$GATEWAY_IP:$PORT/iclock/ping?SN=$SN")
if http_code_ok "$CODE"; then
  ok "Gateway direto por IP: HTTP $CODE."
else
  fail "HTTP $CODE — porta 8080 do gateway não responde. Deploy do PR #16 pendente?"
fi


# ------------------------------------------------------------------------------
section "Descoberta — como os REPs reais estão configurados hoje?"
# ------------------------------------------------------------------------------
echo "  Rode isto NA VPS-API-2 (SSH) pra ver o Host header das requests dos REPs:"
echo ""
echo "    ssh vps-api-2 'sudo tail -f /var/log/nginx/access.log | grep -oE \"Host: [^ ]+\" | sort -u'"
echo ""
echo "    Se aparecer Host: $DOMAIN → REPs usam DOMÍNIO ✅ (só troca DNS basta)"
echo "    Se aparecer Host: $SOLTECH_IP → REPs usam IP DIRETO ⚠️ (precisa reconfigurar cada REP)"


# ------------------------------------------------------------------------------
section "Limpeza"
# ------------------------------------------------------------------------------
echo "  Pra apagar o device de teste ($SN) do dashboard após os testes:"
echo ""
echo "    ssh root@$GATEWAY_IP \"docker exec zekateco-web-db-1 mysql -uroot \\"
echo "      -p\\\$(grep MYSQL_ROOT_PASSWORD /opt/zekateco-web/.env | cut -d= -f2) \\"
echo "      zekateco -e \\\"DELETE FROM devices WHERE sn='$SN'; DELETE FROM logs WHERE sn='$SN';\\\"\""
echo ""
echo -e "${CY}Fim.${NC}"
