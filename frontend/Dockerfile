# ============================================================
# Report frontend (Next.js 16 / React 19) — production (standalone)
# Контекст сборки = ./frontend
#
# КРИТИЧНО: НЕ передавать NEXT_PUBLIC_API_URL (ни build-arg, ни ENV).
# Оставляем НЕзаданным -> lib/api.ts в браузере резолвит в same-origin "/api",
# который Caddy направляет в backend. Абсолютный origin, запечённый в сборку,
# увёл бы все API-запросы мимо /api -> 404. Подробности — runbook §10.
# ============================================================

# ---- Stage 1: deps (кэш по lockfile) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# СПЕЦИАЛЬНО не задаём NEXT_PUBLIC_API_URL -> браузер использует "/api"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Stage 3: runner (минимальный) ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# standalone кладёт server.js в корень; он уважает PORT + HOSTNAME
CMD ["node", "server.js"]
