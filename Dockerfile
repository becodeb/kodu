# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# KoduEdu — imagen multi-stage: dev (hot reload) y runner (producción)
# Se usa bookworm-slim en vez de alpine: Prisma sobre musl exige binaryTargets y
# openssl extra, y no vale la pena esa complejidad por unos MB.
# ─────────────────────────────────────────────────────────────────────────────
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
# curl va para que el healthcheck del orquestador (Coolify/Compose) pueda
# consultar la app desde adentro del contenedor.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# ── deps: dependencias completas (dev incluidas: hacen falta para build y CLI)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── dev: hot reload contra el bind mount del compose de desarrollo
FROM deps AS dev
ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=3000 \
    CHOKIDAR_USEPOLLING=true
COPY . .
EXPOSE 3000
CMD ["sh", "docker/dev-entrypoint.sh"]

# ── build: genera el cliente Prisma y compila el servidor Astro standalone
FROM deps AS build
ENV NODE_ENV=production
# prisma.config.ts exige DATABASE_URL para cargarse. `prisma generate` no se
# conecta a la base, así que alcanza con un valor de relleno: en runtime lo pisa
# el compose, y este stage no forma parte de la imagen final.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
COPY . .
RUN npm run build

# ── runner: imagen final, solo dependencias de producción + dist
FROM base AS runner
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/docker/prod-entrypoint.sh ./docker/prod-entrypoint.sh

# /app/uploads es punto de montaje de volumen persistente (SPEC §6)
RUN mkdir -p /app/uploads/assets && chown -R node:node /app/uploads

USER node
EXPOSE 3000
# El contenedor aplica sus propias migraciones antes de arrancar, así se puede
# desplegar solo (Coolify, `docker run`) sin un job de migración aparte.
CMD ["sh", "docker/prod-entrypoint.sh"]
