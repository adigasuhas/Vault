# syntax=docker/dockerfile:1
# VAULT production image: Next.js server + Prisma migrations on start.
#   docker build -t vault .
#   docker run --env-file .env.production -p 3000:3000 vault
# or use docker-compose.yml, which also runs Postgres.

ARG NODE_VERSION=24

# ---- dependencies (full, for the build) ----
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which needs the schema copied above.
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# The build imports server modules that validate config, so it needs
# placeholders; real values are supplied at runtime.
RUN JWT_SECRET=build-time-placeholder-not-used-at-runtime-000000 \
    DATABASE_URL=postgresql://build:build@localhost:5432/build \
    npm run build

# ---- production dependencies only ----
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime ----
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node package.json package-lock.json next.config.ts prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src/lib/pdf/fonts ./src/lib/pdf/fonts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1
# Apply pending migrations (idempotent), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx next start -H \"$HOSTNAME\" -p \"$PORT\""]
