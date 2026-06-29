# ─────────────────────────────────────────────────────────────────────────────
# Dockerfile do BACKEND (apps/api — NestJS) — Avequi ERP
#
# 📌 CONTEXTO PRO TIME (por que este arquivo existe):
#   O backend usa filas Bull + cron jobs (@nestjs/schedule) = PROCESSO SEMPRE
#   LIGADO. Isso NÃO funciona em serverless (Vercel). Por isso a API precisa de
#   um host de container/processo persistente. Este Dockerfile empacota a API
#   para qualquer plataforma com free tier: Render, Railway ou Fly.io.
#
#   👉 Quem deveria continuar no Vercel é SÓ o frontend (apps/web).
#   👉 Detalhes completos do setup em /DEPLOY.md (raiz do repo).
#
# 🔧 BUILD CONTEXT = RAIZ DO MONOREPO (precisa do package-lock e do workspace
#    packages/shared). No Render: Root Directory = vazio (raiz), Dockerfile Path
#    = apps/api/Dockerfile.
#
# 🔑 VARIÁVEIS (preencher no painel da plataforma, NUNCA commitar segredos):
#    DATABASE_URL, DIRECT_URL (Supabase) · REDIS_URL (Upstash) · JWT_SECRET ·
#    JWT_REFRESH_SECRET · WEB_URL (URL do front na Vercel, p/ CORS) · etc.
#    ⚠️ REDIS_URL é OBRIGATÓRIO (validação Joi) — sem ele a API não sobe.
# ─────────────────────────────────────────────────────────────────────────────

# ─── Stage 1: build ───
FROM node:20-alpine AS builder
WORKDIR /app

# Copia o monorepo (o .dockerignore na raiz exclui node_modules/.next/dist/.git)
COPY . .

# Instala tudo do lockfile e gera o Prisma Client
RUN npm ci
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

# Builda a API respeitando o grafo do Turbo (constrói packages/shared antes)
RUN npx turbo run build --filter=@gdr-erp/api

# ─── Stage 2: runtime enxuto ───
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# OpenSSL — necessário pro Prisma query engine (libquery_engine-linux-musl.so.node)
RUN apk add --no-cache openssl

# Só o necessário pra rodar
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api

# ⚠️ PONTE DE PORTA (sem mexer no código do backend):
#   O main.ts faz bind em API_PORT (apps/api/src/main.ts) — mas Render/Railway/Fly
#   injetam a porta em $PORT. A forma shell abaixo mapeia $PORT -> API_PORT em
#   runtime, mantendo o fallback 3001 pra dev local.
EXPOSE 3001
CMD ["sh", "-c", "API_PORT=${PORT:-3001} node dist/src/main"]
