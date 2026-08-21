#!/bin/sh
# Arranque en producción: aplica las migraciones pendientes y levanta el servidor.
#
# La imagen migra sola a propósito: así se puede desplegar como un único
# contenedor (Coolify, Dokku, `docker run`) sin depender de un job externo.
# `migrate deploy` es idempotente y toma un advisory lock en Postgres, así que
# es seguro aunque arranquen varias réplicas a la vez.
set -e

echo "> Aplicando migraciones pendientes..."
npx prisma migrate deploy

echo "> Iniciando KoduEdu en ${HOST:-0.0.0.0}:${PORT:-3000}"
exec node ./dist/server/entry.mjs
