#!/bin/sh
set -e

# --accept-data-loss é seguro aqui porque nossa tabela commands é
# efêmera (comandos em vôo, não é source-of-truth do ponto). E o Prisma
# só pede confirmação em adicionar constraints, não em deletar dados.
echo "[entrypoint] Aplicando schema Prisma (db push)..."
until npx prisma db push --skip-generate --accept-data-loss; do
  echo "[entrypoint] MySQL ainda nao pronto, retry em 3s..."
  sleep 3
done

echo "[entrypoint] Iniciando servidor..."
exec npx tsx server.ts
