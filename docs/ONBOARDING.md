# Onboarding — Avequi ERP

Guia pra entrar no projeto e ficar na **mesma stack** do time. Complementa o
[`CLAUDE.md`](../CLAUDE.md) (arquitetura detalhada) e o
[`docs/VERSIONING.md`](./VERSIONING.md) (fluxo de release).

---

## 1. O que é

ERP industrial da **GDR Reboques** (substitui o Omie). Monorepo npm workspaces + Turbo:

| Camada | Tech | Pasta |
|---|---|---|
| API | NestJS 10 + Prisma 5 + PostgreSQL (Supabase) + Bull/Redis | `apps/api` |
| Front | Next.js 14 (App Router) + Tailwind + React Query | `apps/web` |
| Shared | tipos/utilitários | `packages/shared` |

- **Repo:** https://github.com/adminadmin-AI/Avequi (privado)
- **Board:** https://github.com/users/adminadmin-AI/projects/7
- **Front (prod):** https://avequi-web-psi.vercel.app (Vercel)
- **API (prod):** https://api.avecchi.ai/api · Swagger em `/docs`
  - O domínio antigo (`avequi-api-production.up.railway.app`) continua ativo e responde igual — é a rede de segurança do rollback, não o endereço oficial.
- **Versão em prod:** `GET /api/version` → `{version, gitSha, builtAt, env}`

---

## 2. Acessos necessários

| Recurso | Pra quê |
|---|---|
| **GitHub** `adminadmin-AI/Avequi` (write) | código, PRs |
| **GitHub Project** (board projects/7) | issues/roadmap (automático como colaborador) |
| **Vercel** — time `adminnexoprimecombrs-projects` | deploy do front + Turbo Remote Cache |
| **Railway** — projeto `avequi-api` | deploy da API + logs/env |
| **Supabase** — projeto `avliarleakraczikvwwz` | banco (dashboard, restaurar do free tier) |

> Peça ao admin (Claudio) pra confirmar Vercel / Railway / Supabase — o acesso ao GitHub já dá o código e os PRs.

---

## 3. Rodar localmente

Pré-requisitos: **Node ≥ 20**, Redis, os arquivos `.env`.

```bash
git clone https://github.com/adminadmin-AI/Avequi && cd Avequi
npm ci
npm run db:generate --workspace=apps/api    # prisma generate — o build precisa do client!
brew services start redis                    # fila Bull/Redis

# .env (pedir ao time — NÃO estão no repo):
#   • raiz: VAPID (push web)
#   • apps/api/.env: DATABASE_URL (pooler 6543, pgbouncer) + DIRECT_URL (5432, p/ DDL)

# subir:
cd apps/api && npm run dev     # API  → http://localhost:3001/api  (Swagger /docs)
cd apps/web && npm run dev     # Front → http://localhost:3000
```

**Login de dev:** `admin@gdr.com.br` / `Admin@123` (SUPER_ADMIN).

**Supabase / IPv6:** conexão direta (5432) não resolve em alguns Macs — usar o **pooler**
(`aws-1-us-west-2.pooler.supabase.com`; 6543 queries, 5432 migrations). O projeto pausa
por inatividade no free tier — restaurar no dashboard antes de usar.

---

## 4. Fluxo de trabalho ⚠️ (a `main` é protegida)

**Não há push direto na `main`.** Todo trabalho vai por PR:

```
git checkout -b feat/minha-mudanca
# ... código ...
npm run build            # rode ANTES do PR — o CI barra build quebrado
git push -u origin feat/minha-mudanca
gh pr create             # abre o PR
# CI roda (lint · build · test) → com os 3 verdes, o merge libera
gh pr merge --squash --delete-branch
```

- **CI obrigatório:** 3 checks (`lint`, `build`, `test`) precisam passar. Não exige revisor
  (você mergeia o próprio PR), mas exige CI verde.
- **Sempre rode `npm run build` local antes.** O `jest` usa mock do Prisma e **não pega
  erro de tipo** — só o `tsc`/`nest build` pega (isso já quebrou 2× antes do CI existir).

---

## 5. CI (GitHub Actions)

Workflow `.github/workflows/ci.yml` — em todo PR e push na `main`, **3 jobs paralelos**:

| Job | Roda |
|---|---|
| `lint` | `npm run lint` (ESLint: web = next/core-web-vitals, api = @typescript-eslint) |
| `build` | `prisma generate` → `npm run build` (turbo: shared + api + web) |
| `test` | `npm run test` (jest da API, ~2000 testes) |

- **Turbo cache** local (`actions/cache`) + **Remote Cache (Vercel)** — builds
  reaproveitados entre CI e máquinas. Pra sua máquina entrar no cache remoto:
  `npx turbo login && npx turbo link`.

---

## 6. Versionamento & deploy

SemVer, versão única sincronizada nos 4 `package.json`. Fluxo completo em
[`docs/VERSIONING.md`](./VERSIONING.md). Resumo:

```bash
npm run changelog:draft -- --write   # popula [Unreleased] (revisar)
npm run release:minor                # bump X.Y.Z + data o CHANGELOG (patch/minor/major)
# PR chore/release-X.Y.Z → merge → tag vX.Y.Z + gh release
npm run deploy:api                   # estampa SHA + railway up (deploy da API)
```

- **Front (Vercel):** deploy **automático** a cada merge na `main`.
- **API (Railway):** deploy **manual** via `npm run deploy:api` (não é GitHub-connected;
  `git pull` na main antes). Boot = `node dist/main` (não roda migration/seed).

---

## 7. Convenções que pegam novato

- **Multi-tenancy:** todo dado é isolado por `companyId`, que vem **sempre do JWT**
  (`@CurrentUser()`), nunca do body/query.
- **RBAC v2:** controllers usam `@RequirePermission('dominio.recurso.acao')`; catálogo em
  `iam/roles.catalog.ts`. Reuse permissão existente pra não mexer na matriz.
- **Schema Prisma:** colunas **camelCase**; migrations **nunca fazem DROP** (só aditivas);
  Prisma **não aceita** comentário `/* */` — só `//` e `///`.
- **Jest:** rodar de `apps/api`; `PrismaService` é mockado (mock em `src/__mocks__`).
  Enums do `@prisma/client` podem faltar no mock → usar string literal `'VALOR' as TipoEnum`.
- **Front (UI):** usar os tokens do **brandbook v2.0** no Tailwind (`brand-*`, `content`,
  `surface`, `success/danger`, type scale `text-heading/subtitle/caption`) — nunca hex/slate
  cru. Reusar componentes de `@/components/ui/*`, dados via React Query + `@/lib/api-client`.
- **Regras de schema** (não alterar): `StockBalance` (available/reserved/inTransit),
  `SalesOrder`/`PurchaseOrder` sem total → calcular de `items[]`, `Customer.document`,
  `Supplier.cnpj`. Ver `CLAUDE.md` pra a lista completa.

---

## 8. O que evoluiu recentemente (v1.1.0)

- **Backend FIN (FP&A, consultoria Wellington):** formação de preço (#395), custeio por
  absorção (#396), forecast financeiro (#397), budget por drivers (#398), análise de
  investimentos VPL/TIR (#399), + chassi na transferência (#628).
- **5 telas novas no menu Financeiro** consumindo esses endpoints (guardadas por `FINANCE_ROLES`).
- **Infra de qualidade:** ESLint nos 2 apps, CI (lint/build/test) + branch protection,
  Turbo Remote Cache, versionamento SemVer com `/api/version`.

Pra retomar contexto detalhado, ver `CLAUDE.md` e o histórico de PRs/CHANGELOG.
