# Avequi ERP — GDR Reboques

ERP industrial desenvolvido para substituir o Omie na GDR Reboques. Fabricante de reboques, com 14 setores produtivos, 3 filiais e dados reais já migrados (2.528 lançamentos financeiros do Omie).

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
│   ├── guards/           # JwtAuthGuard, LocalAuthGuard, RolesGuard
│   └── decorators/       # @Roles(), @CurrentUser()
├── prisma/               # PrismaModule global + PrismaService
├── modules/              # 33 módulos de domínio (ver lista abaixo)
├── app.module.ts         # Imports, ConfigModule, BullModule, EventEmitter, Schedule
└── main.ts               # ValidationPipe global, CORS, Swagger
```

### O que NÃO existe (ainda) — não fingir que existe

- **CompanyGuard** — NÃO existe. Não há guard de tenant global. (#155)
- **AuditInterceptor** — NÃO existe. Audit logs são manuais e inconsistentes. (#155)
- **ThrottlerModule** — NÃO instalado. Rate limiting não funciona. (#156)
- **Helmet** — NÃO instalado. Sem headers de segurança. (#157)
- **GlobalExceptionFilter** — NÃO existe. Stack traces vazam. (#201)
- **Validação de env vars** — NÃO existe. App não falha no boot se JWT_SECRET faltar. (#202)
- **RLS no Supabase** — NÃO verificado/ativo. (#198)

### O que existe e funciona

- `ValidationPipe` global (whitelist + forbidNonWhitelisted + transform) em `main.ts`
- `EventEmitterModule` com 4 eventos: `purchase.goods_received`, `sales.order.confirmed`, `sales.order.invoiced`, `transfer.dispatched`
- `ScheduleModule` com 6 cron jobs em `AlertScheduler`
- `BullModule` com fila `REPORT_QUEUE` (cost-history, stock-abc, production-efficiency)
- CORS configurado via `WEB_URL` env var
- Swagger com Bearer Auth em `/docs`

## 34 Módulos

auth, company, user, product, supplier, customer, bom, routing, warehouse, stock, purchase, sales, fiscal, finance, transfer, demand, mrp, production, wms, dashboard, report, forecast, alert, quality, analytics, serial, maintenance, supplier-portal, quotation, inbound-nfe, capacity, batch, prisma

**54 modelos Prisma** · **39 enums** · **214 arquivos** · **30 spec files** (27/34 módulos cobertos)

### Módulos SEM testes (7)

`auth`, `company`, `customer`, `routing`, `supplier`, `user`, `warehouse`

## Multi-tenancy

**REGRA:** todo dado é isolado por `companyId`. Todas as entidades têm `companyId`.

```typescript
// CORRETO — companyId do JWT
async findAll(@CurrentUser() user: AuthUser) {
  return this.prisma.product.findMany({
    where: { companyId: user.companyId },
  });
}

// ERRADO — IDOR cross-tenant (VULNERABILIDADE ATUAL em 35+ métodos)
async findAll(@Query('companyId') companyId: string) { ... }
```

**ALERTA CRÍTICO:** Atualmente, companyId vem de `@Query()` ou `@Body()` em 35+ métodos de TODOS os controllers. Isso é IDOR cross-tenant — qualquer usuário autenticado pode acessar dados de outra empresa. Fix planejado em #158.

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

`RolesGuard` existe mas NÃO está registrado globalmente — aplicado manualmente por controller via `@UseGuards(JwtAuthGuard, RolesGuard)`. Alguns controllers não aplicam, ficando abertos a qualquer autenticado.

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
| Webhook fiscal sem auth/HMAC | `fiscal.controller.ts:22` | #159 |

## Segurança — estado real (auditoria 22/06/2026, score 15/100)

### O que funciona
- JWT access + refresh com SHA-256 hash no banco
- `isActive` check funciona
- Webhook fiscal usa `timingSafeEqual` (mas sem secret configurado — #159)
- BankAccount credentials com AES-256-GCM (`EncryptionService`)

### O que NÃO funciona / NÃO existe
- Guards não estão globais (JwtAuth, Roles, Company — todos per-controller) — #155
- ThrottlerModule não instalado — brute-force livre em `/auth/login` — #156
- Helmet não instalado — #157
- IDOR em 35+ métodos — #158
- SoD ausente (mesmo user cria e aprova PO) — #160
- Exception filter global ausente — #201
- Env vars não validadas no boot — #202
- Auth module sem testes — #203

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
3. 30 spec files com boa cobertura (27/34 módulos)
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

**Fase 0 — Segurança (PRÓXIMO):** #155-#160, #201-#203
**Fase 1 — Fiscal:** #161-#166
**Fase 2 — Financeiro:** #167-#173
**Fase 3 — E2E:** #174-#179
**Fase 4 — Produção:** #180-#186
**Fase 5 — Comercial:** #187-#192
**Fase 6 — Fiscal Complementar:** #193
**Fase 7 — Maturidade:** #194-#200

## Referências

- **GitHub:** https://github.com/adminadmin-AI/Avequi
- **Project Board:** https://github.com/users/adminadmin-AI/projects/7/views/1
- **Supabase:** https://supabase.com/dashboard/project/avliarleakraczikvwwz
- **Vercel:** https://avequi.vercel.app
- **Brandbook:** https://avequi-brandbook.vercel.app/
- **Swagger (local):** http://localhost:3001/docs

## ALERTA DE SEGURANÇA

Credenciais foram expostas no histórico git (repo foi público). Rotacionar:
- [ ] Senha Supabase
- [ ] JWT Secrets
- [ ] Token Focus NFe
- [ ] BANK_ENCRYPTION_KEY
- [ ] Senha admin
