# Avequi ERP — GDR Reboques

ERP industrial desenvolvido para substituir o Omie na GDR Reboques. Fabricante de reboques, com 14 setores produtivos, 3 filiais e dados reais já migrados (2.528 lançamentos financeiros do Omie).

> 👥 **Novo no projeto?** Comece pelo [`docs/ONBOARDING.md`](docs/ONBOARDING.md) — acessos, setup local, fluxo de PR/CI e convenções. **A `main` é protegida** (branch → PR → CI verde → merge; sem push direto).

## Stack

| Camada | Tecnologia |
|--------|------------|
| API | NestJS 10 + TypeScript |
| ORM | Prisma 5 |
| Banco | PostgreSQL via Supabase (pooler porta 6543) |
| Filas | Bull + Redis |
| Auth | JWT (access + refresh, SHA-256 no banco) |
| Fiscal | Focus NFe (emissão NF-e/NFC-e) |
| Docs | Swagger em `/docs` |
| Frontend | Next.js 14 (apps/web) |

**Monorepo npm workspaces:** `apps/api` · `apps/web` · `packages/*`

## Desenvolvimento local

```bash
npm install
cd apps/api && npm run start:dev
# API: http://localhost:3001/api
# Swagger: http://localhost:3001/docs
```

**Variáveis de ambiente:** copie `.env.example` → `.env` na raiz e preencha.

## Arquitetura da API (`apps/api/src/`)

```
src/
├── common/
│   ├── guards/           # JwtAuthGuard, CompanyGuard, RolesGuard, LocalAuthGuard
│   ├── filters/          # AllExceptionsFilter (global)
│   ├── interceptors/     # AuditInterceptor (global)
│   └── decorators/       # @Roles(), @CurrentUser(), @Public()
├── prisma/               # PrismaModule global + PrismaService
├── modules/              # 33 módulos de domínio (ver lista abaixo)
├── app.module.ts         # Imports, ConfigModule (validação Joi), BullModule, EventEmitter, Schedule, Throttler, guards globais (APP_GUARD)
└── main.ts               # Helmet, ValidationPipe global, CORS, Swagger
```

### O que NÃO existe (ainda) — não fingir que existe

- **`EncryptionService` / AES-256-GCM para BankAccount** — NÃO existe no código (só em docs). `BANK_ENCRYPTION_KEY` não tem consumidor.
- **RLS efetivo no Supabase** — policies existem (migrations phase7_rls) mas estão INATIVAS na prática: a API conecta como role `postgres` (dono do schema, imune a RLS). O encanamento de tenant por transação foi entregue no PR #452 (aberto), mas falta criar role dedicado no Supabase.
- **Cookie httpOnly para tokens** — tokens ainda vão no body/localStorage; decisão pendente.
- **Conciliação CNAB e boleto/PIX real** — stubs 501 no backend.

### O que existe e funciona

- **Guards GLOBAIS via `APP_GUARD`** em `app.module.ts`, nesta ordem: `JwtAuthGuard` (respeita `@Public()`) → `CompanyGuard` → `RolesGuard` → `ThrottlerGuard`
- **Helmet** instalado (`main.ts`)
- **ThrottlerModule** instalado: 60 req/60s global + limites específicos (5/60s login, 10/60s refresh)
- **AllExceptionsFilter** global: não vaza stack trace, mapeia erros Prisma (P2002/P2025/P2003), inclui `requestId`
- **Validação Joi de env vars** no boot (`app.module.ts`) — app falha se JWT_SECRET faltar
- **AuditInterceptor** global
- `ValidationPipe` global (whitelist + forbidNonWhitelisted + transform) em `main.ts`
- `EventEmitterModule` com 4 eventos: `purchase.goods_received`, `sales.order.confirmed`, `sales.order.invoiced`, `transfer.dispatched`
- `ScheduleModule` com 6 cron jobs em `AlertScheduler`
- `BullModule` com fila `REPORT_QUEUE` (cost-history, stock-abc, production-efficiency)
- CORS configurado via `WEB_URL` env var
- Swagger com Bearer Auth em `/docs`

## 34 Módulos

auth, company, user, product, supplier, customer, bom, routing, warehouse, stock, purchase, sales, fiscal, finance, transfer, demand, mrp, production, wms, dashboard, report, forecast, alert, quality, analytics, serial, maintenance, supplier-portal, quotation, inbound-nfe, capacity, batch, prisma

**54 modelos Prisma** · **39 enums** · **44 spec files** em `apps/api/src`

### Módulos SEM testes (7)

`company`, `customer`, `routing`, `scheduling`, `supplier`, `user`, `warehouse`

`auth` TEM testes (`auth.service.spec.ts`, `jwt.strategy.spec.ts`) — não repetir que "auth não tem testes". O módulo `user` + guards/filter/interceptor ganham 51 testes no PR #456 (aberto).

## Multi-tenancy

**REGRA:** todo dado é isolado por `companyId`. Todas as entidades têm `companyId`.

```typescript
// CORRETO — companyId do JWT
async findAll(@CurrentUser() user: AuthUser) {
  return this.prisma.product.findMany({
    where: { companyId: user.companyId },
  });
}

// ERRADO — IDOR cross-tenant (padrão JÁ ELIMINADO — nunca reintroduzir)
async findAll(@Query('companyId') companyId: string) { ... }
```

**Estado atual:** o padrão `@Query('companyId')` foi eliminado dos controllers. O resíduo real (companyId aceito em 16 DTOs de body) foi corrigido no PR #450 (aberto): companyId sai dos DTOs, vem SEMPRE do JWT e é imutável em update (API + web). Após o merge do #450, `companyId` nunca deve ser aceito do cliente.

## Roles e permissões

```
SUPER_ADMIN → tudo
DIRECTOR    → leitura geral + aprovações
MANAGER     → gestão operacional
COMMERCIAL  → vendas + clientes
PRODUCTION  → ordens de produção + BOM
QUALITY     → qualidade
WAREHOUSE   → estoque + transferências
FINANCIAL   → financeiro + fiscal
STORE       → loja (transferências)
READER      → somente leitura
```

`RolesGuard` É global via `APP_GUARD` (junto com `JwtAuthGuard` e `CompanyGuard`) — não é preciso `@UseGuards()` por controller. Endpoints sem `@Roles()` ficam liberados a qualquer autenticado; o PR #453 (aberto) aplica `@Roles` em 100% das mutations (~110 endpoints) e documenta a matriz em `docs/RBAC.md`.

## Banco de dados — regras críticas do schema

Colunas são **camelCase** no banco.

| Modelo | Campos que pegam novatos |
|--------|--------------------------|
| `StockBalance` | `available`, `reserved`, `inTransit`, `pendingPutaway` |
| `SalesOrder` | sem `orderNumber` nem `totalAmount` → calcular de `items[]` |
| `PurchaseOrder` | idem → calcular de `items[]` (`POItem`) |
| `StockMovement` | campo `quantity` (não `qty`), sem `unitCost` |
| `Customer` | campo `document` (não `taxId`), tem `city` e `state` |
| `Supplier` | campo `cnpj` (não `taxId`), sem `city`/`state`; campo `contact` |
| `Product` | campos `costPrice`, `salePrice`, `avgCost`; tem `minStock` |
| `User` | sem campo `phone` |
| `Company` | Dados fiscais: `razaoSocial`, `ie`, `im`, `crt`, `taxRegime`, `suframa`, `cnae` + endereço completo (#161) |
| Tabela NF-e entrada | `gdr_inbound_nfe` |

### Regra de migração

**Migrations nunca fazem DROP.** Apenas mudanças aditivas.

## Bugs conhecidos

| Bug | Local | Issue |
|-----|-------|-------|
| `calcRevenue` retorna 0 hardcoded | `dashboard.service.ts:172` | #173 |
| Picking criado APÓS stock EXIT | `sales.service.ts:167` / `wms.listener.ts:24` | #177 |
| `importAsGr` não gera StockMovement nem FinancialEntry | `inbound-nfe.service.ts:162` | #175 |
| Devolução não reverte CR nem NF-e | `sales.service.ts:249` | #178 |
| PO fecha na 1ª entrega parcial (sem PARTIALLY_RECEIVED) | `purchase.service.ts:366` | #190 |

**Corrigido (não é mais bug):** webhook fiscal (#159) — JÁ exige header `x-focus-token` validado com `timingSafeEqual` e rejeita a requisição se o secret não estiver configurado (fail-closed).

## Segurança — estado real (auditoria de código 03/07/2026)

A auditoria de 22/06 (score 15/100) está OBSOLETA — a maior parte dos itens foi corrigida na main ou está em PR aberto.

### O que funciona (verificado na main)
- Guards globais via `APP_GUARD`: `JwtAuthGuard` (respeita `@Public()`) → `CompanyGuard` → `RolesGuard` → `ThrottlerGuard` — #155 ✅
- ThrottlerModule instalado: 60 req/60s global, 5/60s login, 10/60s refresh — #156 ✅
- Helmet instalado em `main.ts` — #157 ✅
- `AllExceptionsFilter` global: sem vazamento de stack, mapeia P2002/P2025/P2003, `requestId` — #201 ✅
- Validação Joi de env vars no boot — #202 ✅ (endurecida no PR #455)
- `AuditInterceptor` global
- JWT access + refresh: senha com bcryptjs; refresh token rotacionado, SHA-256 no banco
- `isActive` check funciona
- Auth TEM testes: `auth.service.spec.ts` e `jwt.strategy.spec.ts` — #203 ✅
- Webhook fiscal exige `x-focus-token` com `timingSafeEqual` e rejeita se secret ausente (fail-closed) — #159 ✅

### O que NÃO funciona / NÃO existe (na main)
- `EncryptionService`/AES-256-GCM para BankAccount NÃO existe (docs mentem); `BANK_ENCRYPTION_KEY` sem consumidor
- RLS inativo na prática: policies existem (phase7_rls) mas a API conecta como role `postgres` (imune a RLS) — encanamento no PR #452, falta role dedicado no Supabase
- IDOR residual: companyId em 16 DTOs de body — corrigido no PR #450 (aberto)
- SoD ausente (mesmo user cria e aprova PO) — #160 — corrigido no PR #454 (aberto)
- Endpoints de mutation sem `@Roles()` — corrigido no PR #453 (aberto)
- Tokens no localStorage (sem cookie httpOnly) — decisão pendente
- Credenciais expostas no histórico git ainda NÃO rotacionadas (ver ALERTA DE SEGURANÇA no fim)

### Hardening IAM 03/07/2026 — PRs abertos (aguardando revisão do Rafael, NÃO mergeados)

| PR | Branch | Conteúdo |
|----|--------|----------|
| #450 | `sec/idor-residual` | companyId fora dos DTOs, sempre do JWT, imutável em update (API + web) |
| #452 | `sec/tenant-rls-fix` | Remove TenantMiddleware morto; tenant via interceptor pós-auth + extensão Prisma com `set_config` em transação; RLS ainda requer role dedicado |
| #453 | `sec/rbac-matrix` | `@Roles` em 100% das mutations (~110 endpoints), matriz em `docs/RBAC.md`, fix SUPER_ADMIN bloqueado em bom/routing/stock |
| #454 | `sec/sod-enforcement` | Bloqueia auto-aprovação e aprovador repetido (SUPER_ADMIN incluso) |
| #455 | `sec/env-validation` | Joi completo (`JWT_REFRESH_SECRET` required ≠ `JWT_SECRET`, `FOCUS_NFE_WEBHOOK_SECRET` required em prod etc.), schema em `src/config/env.validation.ts`, `.env.example` reescrito |
| #456 | `sec/guard-tests` | 51 testes: guards, filter, audit interceptor, módulo user (100% linhas nos arquivos alvo); confirma senha re-hasheada em update e nunca vazada |
| #457 | `sec/web-route-guards` | Guard de rota por role no apps/web, página "Acesso negado", fonte única `nav-config` |

Issue #451: 17 testes pré-quebrados na main (batch/mrp/sales/purchase), fora do escopo IAM.

**Pendências após merge dos PRs:**
- Revisão da matriz RBAC pelo Rafael (`docs/RBAC.md`, PR #453)
- Criar role dedicado no Supabase (não-`postgres`) para RLS ter efeito real (complementa #452)
- Executar checklist Railway de env vars ANTES de mergear o #455 (descrito no corpo do PR)
- Decisão sobre cookie httpOnly para tokens
- Rotação de credenciais (ALERTA DE SEGURANÇA abaixo — continua válido)

## Fiscal — estado real (score 15/100)

- Focus NFe: emissão NF-e/NFC-e funciona (emit + status + webhook)
- CST **hardcoded 102** em 3 lugares (`fiscal-mapper.ts:76,119,169`)
- 4 CFOPs hardcoded (5102/6102/5152/6152) — faltam industriais
- **Sem** cancelamento NF-e, CC-e, inutilização
- Company com dados fiscais completos (IE, CRT, endereço, CNAE, regime tributário)
- **Sem** FiscalDocumentItem/ItemTax — itens não persistidos

## Financeiro — estado real (score 12/100)

- `pay()` marca PAID incondicionalmente (sem pagamento parcial)
- Sem categorias gerenciais, sem DRE, sem centros de custo
- Sem lançamentos manuais (só auto via eventos)
- BankAccount existe mas desconectado de FinancialEntry
- Cash flow é snapshot estático, não projeção

## Pontos fortes confirmados

1. Event-driven (EventEmitter2) — desacoplamento entre módulos
2. Multi-tenancy by design — companyId em todas as entidades
3. 44 spec files com boa cobertura (7 módulos ainda sem testes)
4. Custo médio ponderado implementado corretamente
5. WMS funcional (receiving→putaway, inventory count+reconciliação)
6. Forecast com backtest MAPE
7. BOM versionado com scrap
8. Batch/Lote completo (quarentena, validade, rastreabilidade)
9. Capacity Planning (WorkCenter, utilização, gargalos)
10. Quotation lifecycle completo (DRAFT→CONVERTED)
11. Supplier Portal com token auth

## Testes

```bash
cd apps/api
npm test              # unitários (jest)
npm run test:cov      # com cobertura
```

**Convenção:** PrismaService é mockado nos testes unitários. Nunca chamada real ao banco.

## Dados reais no banco (Supabase)

| Tabela | Registros |
|--------|-----------|
| `gdr_companies` | 4 (GDR Matriz + 3 filiais) |
| `gdr_products` | 310 |
| `gdr_bom_versions` | 68 / `gdr_bom_items` 720 |
| `gdr_fiscal_documents` | 11.081 |
| `gdr_financial_entries` | 2.528 (migrados do Omie) |
| `gdr_warehouses` | 3 (ALM-FAB, LOJA-CAS, LOJA-GUA) |

## Credencial de dev

```
Email:    admin@gdr.com.br
Senha:    Admin@123
Perfil:   SUPER_ADMIN
Company:  1f885505-37df-426f-b885-2a7ac889763c (GDR)
```

## Agentes e skills disponíveis

Este projeto usa **GSD (Get Shit Done)** + **xquads-squads**. Ver `.claude/SETUP.md` para instalar.

### Squads mais relevantes

| Squad | Quando usar |
|-------|-------------|
| `/erp-squad` | Módulos NestJS, MRP, regras de negócio ERP |
| `/synapse` | Criar/editar regras de domínio e comandos |
| `/cybersecurity` | Auditorias de segurança, análise de vulnerabilidades |
| `/finance-squad` | Modelagem financeira, CFO virtual |
| `/advisory-board` | Conselho estratégico |

### Comandos GSD

| Comando | Quando usar |
|---------|-------------|
| `/gsd-plan-phase` | Planejar uma nova fase/módulo |
| `/gsd-execute-phase` | Executar um plano de fase |
| `/gsd-code-review` | Revisar código antes de PR |
| `/gsd-debug` | Debugar problemas com método científico |
| `/gsd-secure-phase` | Verificar mitigações de segurança |
| `/gsd-new-project` | Criar roadmap de novo milestone |
| `/gsd-help` | Lista todos os comandos |
| `/gsd-health` | Verifica saúde do setup |

## Roadmap ativo — 49 issues (#155-#203)

**Fase 0 — Segurança (CONCLUÍDA na main + PRs #450–#457 abertos):** #155-#160, #201-#203
**Fase 1 — Fiscal:** #161-#166
**Fase 2 — Financeiro:** #167-#173
**Fase 3 — E2E:** #174-#179
**Fase 4 — Produção:** #180-#186
**Fase 5 — Comercial:** #187-#192
**Fase 6 — Fiscal Complementar:** #193
**Fase 7 — Maturidade:** #194-#200

## Regra de fechamento de issues

Issue só fecha como entregue com **evidência verificável** (PR mergeado, commit resolvível, release, validação objetiva). SHA inexistente, "feito" sem prova e fechamento em lote sem evidência individual **não contam**. A regra completa, com a tabela de evidência por tipo de trabalho, está no [`CONTRIBUTING.md` §12](CONTRIBUTING.md#12-fechamento-de-issues--evidência-obrigatória) — fonte única (#1114).

## Referências

- **GitHub:** https://github.com/adminadmin-AI/Avequi
- **Project Board:** https://github.com/users/adminadmin-AI/projects/7/views/1
- **Supabase:** https://supabase.com/dashboard/project/avliarleakraczikvwwz
- **Vercel:** https://avequi-web-psi.vercel.app
- **Brandbook:** https://avequi-brandbook.vercel.app/
- **Swagger (local):** http://localhost:3001/docs

## ALERTA DE SEGURANÇA

Credenciais foram expostas no histórico git (repo foi público). Rotacionar:
- [ ] Senha Supabase
- [ ] JWT Secrets
- [ ] Token Focus NFe
- [ ] BANK_ENCRYPTION_KEY
- [ ] Senha admin
