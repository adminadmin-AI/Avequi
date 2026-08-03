# Política de Versionamento — Avequi ERP

## Esquema: SemVer (`MAJOR.MINOR.PATCH`)

Uma **única versão para o produto inteiro**, sincronizada em todos os `package.json`
do monorepo (raiz, `apps/api`, `apps/web`, `packages/shared`). O ERP é entregue
como um sistema único, então a versão é do produto — não por pacote.

| Parte | Quando incrementa | Exemplos |
|-------|-------------------|----------|
| **MAJOR** | Marco de negócio ou mudança que quebra dados/contrato | Reforma tributária (IBS/CBS), migração estrutural de módulo |
| **MINOR** | Novo conjunto de funcionalidades, retrocompatível | Sprint de features (ex.: FP&A: pricing, custeio, budget, forecast, investimentos) |
| **PATCH** | Correções e ajustes sem novas features | Hotfix de bug, correção fiscal pontual |

Versão atual de partida: **1.0.0** — o ERP já está em produção faturando NF-e real
(não é mais `0.x` protótipo).

## Onde a versão vive

- **Fonte da verdade:** o campo `version` dos `package.json` (mantê-los iguais).
- **Runtime da API:** `GET /api/version` → `{ name, version, gitSha, builtAt, env }`.
  O Swagger (`/docs`) também lê a versão do `package.json`.
- **Web:** rodapé do app mostra `Avequi ERP vX.Y.Z` (injetado em build via
  `next.config.mjs` → `NEXT_PUBLIC_APP_VERSION`).
- **Git:** cada release é uma **tag `vX.Y.Z`** + **GitHub Release** com as notas.
- **Histórico:** `CHANGELOG.md` (formato *Keep a Changelog*).

### Sobre o `gitSha` / `builtAt`
O deploy da API é manual (`railway up`) e o `.dockerignore` exclui `.git`, então o
commit não está disponível dentro do build Docker. Por isso o SHA é **estampado no
build context** por `scripts/stamp-build-info.js` (gera `apps/api/build-info.json`),
que o `npm run deploy:api` roda antes do `railway up`. Sem stamp (dev/local), o
endpoint reporta `gitSha: "unknown"` — a `version` continua correta.

## Checklist de release

1. **Rascunhar o CHANGELOG** a partir dos PRs mergeados desde a última tag:
   ```bash
   npm run changelog:draft            # revisa o rascunho
   npm run changelog:draft -- --write # popula [Unreleased]
   ```
   Depois **revise/edite** o `[Unreleased]` (agrupe, remova ruído — é rascunho).
2. **Decidir o bump** (MAJOR/MINOR/PATCH) conforme a tabela acima.
3. **Bump da versão** (edita os 4 `package.json` + data o `[Unreleased]` no CHANGELOG):
   ```bash
   npm run release:minor   # ou release:patch / release:major (aceita -- --dry-run)
   ```
4. **Commit + PR** (`chore/release-X.Y.Z`), revisar e mergear na `main`.
5. **Tag + Release:**
   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag   # ou notas do CHANGELOG
   ```
6. **Deploy da API** (Railway, manual — ver docs de deploy):
   ```bash
   npm run deploy:api   # estampa build-info.json (SHA+data) e roda `railway up --ci`
   ```
7. **Validar:** `curl https://api.avecchi.ai/api/version`
   deve refletir a `version` nova e o `gitSha` do commit taggeado.
   **Smoke de isolamento cross-tenant (OPS WP7 #914)** — obrigatório com 2+
   tenants em produção:
   ```bash
   SMOKE_TENANT_A_EMAIL=... SMOKE_TENANT_A_PASSWORD=... \
   SMOKE_TENANT_B_EMAIL=... SMOKE_TENANT_B_PASSWORD=... \
   npm run smoke:isolation
   ```
   (A e B em **tenants diferentes** — ex.: GDR × conta SANDBOX. O script
   prova que B não lê recurso de A por ID e que token de tenant não abre
   `/ops`. Qualquer furo → exit 1: deploy NÃO validado.)
8. **Web (Vercel):** deploy do `apps/web` (o rodapé mostra a versão nova).

> Dica: o `gitSha` no `/api/version` diz **exatamente** qual commit está no ar —
> use isso pra confirmar um deploy em vez de adivinhar por timestamps.
