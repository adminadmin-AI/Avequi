# Avequi ERP — GDR Reboques

ERP industrial da **GDR Reboques** (substitui o Omie). Monorepo npm workspaces + Turbo:
NestJS 10 + Prisma 5 + PostgreSQL/Supabase (`apps/api`) · Next.js 14 + Tailwind (`apps/web`).

> ### 👥 Novo no projeto? Comece aqui
> **[`docs/ONBOARDING.md`](docs/ONBOARDING.md)** — acessos, setup local, fluxo de trabalho e convenções.
>
> ⚠️ **A `main` é protegida:** não há push direto. Fluxo = **branch → PR → CI (`lint`·`build`·`test`) verde → merge**.
> Rode `npm run build` antes de abrir o PR (o `jest` usa mock do Prisma e não pega erro de tipo).

## Links

| | |
|---|---|
| 📘 Onboarding | [`docs/ONBOARDING.md`](docs/ONBOARDING.md) |
| 🏗️ Arquitetura detalhada | [`CLAUDE.md`](CLAUDE.md) |
| 🔖 Versionamento & release | [`docs/VERSIONING.md`](docs/VERSIONING.md) |
| 📋 Board | https://github.com/users/adminadmin-AI/projects/7 |
| 🌐 Front (prod) | https://avequi-web-psi.vercel.app |
| ⚙️ API (prod) | https://api.avecchi.ai/api · [Swagger](https://api.avecchi.ai/docs) |

## Quick start

```bash
npm ci
npm run db:generate --workspace=apps/api   # prisma generate (o build precisa)
brew services start redis
# copiar os .env (raiz + apps/api/.env) — pedir ao time
cd apps/api && npm run dev     # API  → http://localhost:3001/api  (Swagger /docs)
cd apps/web && npm run dev     # Front → http://localhost:3000
```

Login de dev: `admin@gdr.com.br` / `Admin@123`. Detalhes completos no
[`docs/ONBOARDING.md`](docs/ONBOARDING.md).
