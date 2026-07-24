#!/usr/bin/env bash
# ==============================================================================
# Teste do chunking mensal de /api/sync-logs-historic (DEV-46).
#
# Bug original: cursor.setUTCDate(1) forçava o início de TODO chunk pro dia 1
# do mês, ignorando o dia real pedido em `from` — pedir "só hoje" (from=to=
# 2026-07-16) gerava StartTime=2026-07-01 (15 dias a mais do que solicitado).
# Grave porque o comando por trás (DATA QUERY tablename=transaction) já travou
# um REP fisicamente antes (ver docs/CLAUDE.md).
#
# Usa um SN OFFLINE (VDE2252800236, confirmado offline no momento em que este
# script foi escrito) — o comando é gerado e fica na fila, mas nunca chega a
# ser de fato entregue a um REP real, então é seguro rodar sem risco de travar
# nada. Pra reconfirmar contra um REP físico online, trocar SN abaixo e
# verificar Return>=0 no ack antes de considerar concluído.
#
# Uso: bash scripts/test-sync-logs-historic-chunking.sh
# ==============================================================================

set -uo pipefail

API="http://localhost:3001"
SN="VDE2252800236"  # offline no momento do teste — ver nota acima
DB="docker exec zekateco-web-db-1 mysql -uroot -plocalroot zekateco -N"

CY='\033[1;36m'; GR='\033[0;32m'; RD='\033[0;31m'; NC='\033[0m'
section() { echo -e "\n${CY}== $1 ==${NC}"; }
ok()   { echo -e "  ${GR}✓${NC} $*"; }
fail() { echo -e "  ${RD}✗${NC} $*"; EXIT=1; }
EXIT=0

latest_command() {
  $DB -e "SELECT command FROM commands WHERE sn='${SN}' AND command LIKE '%StartTime%' ORDER BY id DESC LIMIT 1;" 2>/dev/null
}

# ------------------------------------------------------------------------------
section "Cenário 1 — intervalo de 1 dia (from=to), dentro do mesmo mês"
# ------------------------------------------------------------------------------
echo "  Pedido: from=2026-07-16, to=2026-07-16 (quer só os logs desse dia)"
curl -s -X POST "$API/api/sync-logs-historic" -H "Content-Type: application/json" \
  -d "{\"from\":\"2026-07-16\",\"to\":\"2026-07-16\",\"sn\":\"$SN\"}" > /dev/null
sleep 1
CMD=$(latest_command)
echo "  Comando gerado: $CMD"
if [[ "$CMD" == *"StartTime=2026-07-16 00:00:00"* && "$CMD" == *"EndTime=2026-07-16 23:59:58"* ]]; then
  ok "StartTime/EndTime batem exatamente com o dia pedido (não expandiu pro dia 1 do mês)"
else
  fail "Esperado StartTime=2026-07-16 00:00:00 / EndTime=2026-07-16 23:59:58, veio: $CMD"
fi

# ------------------------------------------------------------------------------
section "Cenário 2 — intervalo cruzando virada de mês"
# ------------------------------------------------------------------------------
echo "  Pedido: from=2026-06-25, to=2026-07-02 (cruza jun→jul, espera 2 chunks)"
RESP=$(curl -s -X POST "$API/api/sync-logs-historic" -H "Content-Type: application/json" \
  -d "{\"from\":\"2026-06-25\",\"to\":\"2026-07-02\",\"sn\":\"$SN\"}")
echo "  Resposta: $RESP"
CHUNKS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('chunks_per_device'))" 2>/dev/null)
if [[ "$CHUNKS" == "2" ]]; then
  ok "Gerou 2 chunks (quebra correta na virada do mês)"
else
  fail "Esperado 2 chunks, veio: $CHUNKS"
fi
echo -e "\n${CY}Nota:${NC} como a fila é serializada (1 chunk por vez, avança só quando o REP confirma o anterior),"
echo "  e o SN de teste está offline, só o PRIMEIRO chunk chega a ser realmente enfileirado agora."
echo "  Isso já é suficiente pra validar que o cálculo dos chunks está correto (o que este teste cobre)."

exit $EXIT
