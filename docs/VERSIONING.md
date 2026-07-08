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

1. **Decidir o bump** (MAJOR/MINOR/PATCH) conforme a tabela acima.
2. **Atualizar a versão** nos 4 `package.json` (mesmo número).
3. **Atualizar o `CHANGELOG.md`**: mover os itens de `[Unreleased]` para a nova
   seção `## [X.Y.Z] - AAAA-MM-DD`.
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
7. **Validar:** `curl https://avequi-api-production.up.railway.app/api/version`
   deve refletir a `version` nova e o `gitSha` do commit taggeado.
8. **Web (Vercel):** deploy do `apps/web` (o rodapé mostra a versão nova).

> Dica: o `gitSha` no `/api/version` diz **exatamente** qual commit está no ar —
> use isso pra confirmar um deploy em vez de adivinhar por timestamps.
