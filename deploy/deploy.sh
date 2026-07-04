#!/usr/bin/env bash
# Deploy manual do zekateco-web no VPS srv784010.
# Uso: bash deploy/deploy.sh [branch]
#
# Requer:
#   - Chave SSH ~/.ssh/id_ed25519 com acesso ao VPS
#   - Variáveis: VPS_HOST, VPS_USER (defaults abaixo)

set -euo pipefail

BRANCH="${1:-main}"
VPS_HOST="${VPS_HOST:-2.25.208.124}"
VPS_USER="${VPS_USER:-root}"
APP_PATH="${APP_PATH:-/opt/zekateco-web}"

echo "→ Deploy branch=$BRANCH em $VPS_USER@$VPS_HOST:$APP_PATH"

ssh "${VPS_USER}@${VPS_HOST}" bash -s <<ENDSSH
set -euo pipefail

APP_PATH="${APP_PATH}"

if [ ! -d "\$APP_PATH/.git" ]; then
  mkdir -p "\$APP_PATH"
  git clone https://github.com/jose-cleiton/zekateco-web.git "\$APP_PATH"
fi

cd "\$APP_PATH"
git fetch --all --prune
git checkout ${BRANCH}
git reset --hard origin/${BRANCH}

docker compose pull || true
docker compose up -d --build --remove-orphans
docker compose ps
ENDSSH

echo "→ Health check dashboard (:81)"
curl -sf "http://${VPS_HOST}:81/" > /dev/null && echo "  ✅ Dashboard OK" || echo "  ❌ Dashboard falhou"

echo "→ Health check ADMS gateway (:8090)"
curl -sf "http://${VPS_HOST}:8090/iclock/cdata?SN=HEALTHCHECK" > /dev/null && echo "  ✅ Gateway OK" || echo "  ❌ Gateway falhou"
