# syntax=docker/dockerfile:1
# Imagem da integração Vision ⇄ Omie: o mesmo arquivo serve o servidor web e o worker da fila.
#
#   docker compose -f docker/compose.yaml --profile app up -d --build
#
# Servidor web:  node server.js          (padrão)
# Worker:        node dist/worker.mjs
# Migrações:     node dist/migrate.mjs   (a aplicação também aplica ao iniciar)
# Usuário:       node dist/users-create.mjs --email ... --name ... [--role ADMIN|OPERATOR]

ARG NODE_VERSION=22

# ── Dependências (com as de desenvolvimento, para o build) ───────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ── Build: Next em modo standalone + scripts empacotados ─────────────────────────────────
FROM deps AS build
COPY . .
RUN NEXT_OUTPUT=standalone npm run build && npm run build:scripts

# ── Execução: só o servidor enxuto do Next, os scripts e as migrações ────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/dist ./dist
# PGlite (sem DATABASE_URL) grava em ./.data; em produção use PostgreSQL.
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
