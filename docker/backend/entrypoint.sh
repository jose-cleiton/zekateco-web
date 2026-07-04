#!/bin/sh
set -e

echo "[entrypoint] Aplicando schema Prisma (db push)..."
until npx prisma db push --skip-generate; do
  echo "[entrypoint] MySQL ainda nao pronto, retry em 3s..."
  sleep 3
done

echo "[entrypoint] Iniciando servidor..."
exec npx tsx server.ts
