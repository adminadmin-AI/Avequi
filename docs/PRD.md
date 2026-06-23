# GDR — PRD Técnico v2.0

**Sistema ERP Industrial + Lojas**  
Documento de Referência para Desenvolvimento  
Abril 2026 | Confidencial

> **Documento vivo** — atualizar a cada decisão arquitetural relevante.  
> Fonte de verdade para todas as sessões de desenvolvimento.

---

## Índice

1. [Visão Geral do Projeto](#1-visão-geral-do-projeto)
2. [Stack Tecnológica](#2-stack-tecnológica)
3. [Integração Fiscal — Focus NFe](#3-integração-fiscal--focus-nfe)
4. [Modelo de Dados — Schema Prisma](#4-modelo-de-dados--schema-prisma)
5. [Arquitetura de Módulos — NestJS](#5-arquitetura-de-módulos--nestjs)
6. [Autenticação e Controle de Acesso](#6-autenticação-e-controle-de-acesso)
7. [Especificação dos Domínios de Negócio](#7-especificação-dos-domínios-de-negócio)
8. [Roadmap de Desenvolvimento](#8-roadmap-de-desenvolvimento)
9. [Regras de Governança e Qualidade](#9-regras-de-governança-e-qualidade)
10. [Guia de Desenvolvimento com IA](#10-guia-de-desenvolvimento-com-ia)

---

## 1. Visão Geral do Projeto

### Objetivo

Substituir processos manuais e fragmentados (WhatsApp, planilhas, anotações) por um sistema integrado que cubra toda a operação da GDR: fábrica, estoque, compras, MRP, produção, logística, lojas e financeiro.

O sistema é desenvolvido internamente usando uma stack moderna e bem definida para garantir que cada sessão de geração de código produza saída consistente e integrável.

### Contexto

A GDR Reboques opera com:
- Fábrica de produção de reboques
- Múltiplas filiais/lojas
- Processos hoje no WhatsApp e planilhas
- Necessidade de rastreabilidade total da produção ao fiscal

---

## 2. Stack Tecnológica

> Todas as decisões de stack são **obrigatórias**. Nenhum módulo pode ser desenvolvido em tecnologia diferente sem aprovação explícita.

| Camada | Tecnologia |
|---|---|
| Monorepo | Turborepo |
| Backend | NestJS (apps/api) |
| ORM | Prisma |
| Banco de dados | PostgreSQL via Supabase |
| Frontend | Next.js 14 (apps/web) |
| Linguagem | TypeScript (100%) |
| Gerenciador de pacotes | npm workspaces |
| Testes | Jest |
| Filas | BullMQ |
| Monitoramento | Sentry |
| CI/CD | GitHub Actions |
| Integração fiscal | Focus NFe (API REST) |

---

## 3. Integração Fiscal — Focus NFe

### Por que Focus NFe

Após pesquisa comparativa entre as principais APIs do mercado brasileiro (NFe.io, PlugNotas, Spedy, Nota Fácil, Focus NFe), a Focus NFe foi selecionada pelos seguintes critérios:

- Melhor custo-benefício para volume de notas da GDR
- Suporte a NF-e e NFC-e na mesma API
- DANFE automático por email
- Retentativas automáticas em contingência SEFAZ
- Armazenamento de XML incluído no plano

### Fluxo de Integração

O GDR **não** emite nota diretamente na SEFAZ. Todo o processo é delegado à Focus NFe via chamadas REST:

```
1. Venda ou transferência é finalizada no GDR
2. GDR monta o payload JSON com dados da operação
   (produtos, valores, CFOP, destinatário)
3. GDR faz POST → Focus NFe: /v2/nfe ou /v2/nfce
4. Focus NFe assina o XML, valida e envia para a SEFAZ
5. SEFAZ retorna autorização (ou rejeição)
6. Focus NFe devolve: chave de acesso, XML autorizado, status
7. GDR registra a chave na operação → status "faturado"
8. Focus NFe envia DANFE por email ao destinatário automaticamente
```

### Regras de integração fiscal

- Toda transferência fábrica → loja gera NF-e de transferência
- Toda venda loja gera NFC-e (consumidor final) ou NF-e (PJ)
- Toda devolução gera NF-e de devolução
- XMLs armazenados também no GDR por **11 anos** (conformidade legal)
- Certificado digital A1 armazenado **criptografado** (AES-256)

---

## 4. Modelo de Dados — Schema Prisma

> O schema Prisma no repo é a fonte de verdade. Esta seção documenta as regras de negócio e restrições críticas. **Nunca alterar campos sem revisão.**

### 4.1 Regras Universais de Entidade

Toda entidade tem obrigatoriamente:

```prisma
id        String   @id @default(cuid())
companyId String
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

### 4.2 Campos Críticos por Modelo

| Modelo | Regra |
|---|---|
| `StockBalance` | Campos: `available`, `reserved`, `inTransit`, `pendingPutaway` |
| `SalesOrder` | Sem `orderNumber` nem `totalAmount` — calcular de `items[]` |
| `StockMovement` | Campo `quantity` (não `qty`), sem `unitCost` |
| `Customer` | Campo `document` (não `taxId`), tem `city` e `state` |
| `Supplier` | Campo `cnpj` (não `taxId`), sem `city`/`state`; email dentro de `contact` |
| `Product` | Campos `costPrice`, `salePrice`, `avgCost`; tem `minStock` |
| `User` | Sem campo `phone` |

### 4.3 Convenções de Nomenclatura

- **Colunas:** camelCase no banco (Prisma padrão)
- **Exceção:** `gdr_serial_number` usa `@map` explícito
- **Tabela NF-e de entrada:** `gdr_inbound_nfe`

### 4.4 Comandos Prisma

```bash
# Sempre usar o binário local — nunca npx prisma
cd apps/api
../../node_modules/.bin/prisma generate
../../node_modules/.bin/prisma migrate dev
../../node_modules/.bin/prisma migrate deploy
../../node_modules/.bin/prisma studio
```

---

## 5. Arquitetura de Módulos — NestJS

### Princípio de Isolamento

Cada domínio do ERP é um **módulo NestJS independente**. Módulos se comunicam via:

1. **Eventos** (`EventEmitter2`) — para ações assíncronas cross-domínio
2. **Chamadas diretas de serviço** — para consultas síncronas necessárias

**Proibido:** Um módulo acessar o repositório Prisma de outro módulo diretamente.

### Padrão de Evento de Negócio

Todo evento emitido via `EventEmitter2` segue esta interface:

```typescript
interface BusinessEvent {
  eventId:   string;    // cuid() — idempotência
  companyId: string;    // tenant isolation
  userId:    string;    // quem disparou
  occurredAt: Date;
  payload:   unknown;   // tipado por evento específico
}
```

### Exemplos de Fluxo de Eventos

```
SalesOrder.confirmed
  → FiscalModule (emite NFC-e via Focus NFe)
  → FinancialModule (cria FinancialEntry RECEIVABLE)
  → StockModule (StockMovement OUT)

GoodsReceipt.confirmed
  → StockModule (StockMovement IN)
  → FinancialModule (cria FinancialEntry PAYABLE)

ProductionOrder.completed
  → StockModule (IN produto acabado, OUT matéria-prima)
```

---

## 6. Autenticação e Controle de Acesso

### Estratégia JWT

| Token | Duração | Comportamento |
|---|---|---|
| Access Token | 15 minutos | Stateless — carrega `companyId`, `userId`, `role` |
| Refresh Token | 7 dias | Rotação a cada uso; invalidado no logout |

**Payload JWT:**
```json
{ "sub": "userId", "companyId": "...", "role": "MANAGER", "iat": 0, "exp": 0 }
```

### Perfis e Permissões

| Perfil | Escopo |
|---|---|
| `SUPER_ADMIN` | Acesso total, cross-company |
| `DIRECTOR` | Acesso total na própria company |
| `MANAGER` | Acesso operacional completo |
| `FISCAL` | Módulos fiscal e financeiro |
| `STORE` | Apenas dados da própria filial |
| `OPERATOR` | Módulos de produção e chão de fábrica |
| `WAREHOUSE` | Módulos de estoque e WMS |

### Regras de Tenant Isolation

- **Todo** endpoint valida `companyId` do JWT contra os dados da query
- Nenhum endpoint retorna dados de outra company
- Guard de tenant aplicado globalmente via interceptor NestJS
- `STORE` só enxerga dados da própria filial (`storeId` no JWT)

---

## 7. Especificação dos Domínios de Negócio

### Domínio 1 — Administração

> Governa usuários, empresas, perfis e parâmetros globais. Alicerce de todo o multi-tenant.

**Entidades:**
- `Company` (matriz e filiais)
- `User` (com `companyId`)
- `Role` + `Permission`
- `AuditLog`
- `SystemParameter`

**Regras de negócio:**
- Todo usuário pertence a exatamente uma `company`
- `STORE` só enxerga dados da própria filial
- Alterações em parâmetros globais exigem perfil `DIRECTOR`
- `AuditLog` é append-only — **nunca** deletar registros

---

### Domínio 2 — Cadastros Mestres

> Base de dados de referência para toda a operação. Erros aqui se propagam para todos os outros módulos.

**Entidades:**
- `Product` (com tipo e custo médio)
- `BomVersion` (imutável após ativação)
- `BomItem` (componentes + % de perda)
- `RoutingStep` (centro de trabalho + tempo)
- `Supplier`
- `Customer`

**Regras de negócio:**
- BOM só pode ser alterada criando **nova versão** — nunca editar versão ativa
- Produto não pode ser desativado se houver estoque > 0 em qualquer depósito
- NCM é obrigatório para produtos acabados (necessário para NF-e)
- Custo médio recalculado automaticamente a cada recebimento de compra

---

### Domínio 3 — Estoque

> Coração do sistema. Controla saldo em tempo real com proteção contra condição de corrida.

**Entidades:**
- `StockBalance` (por warehouse + produto)
- `StockMovement` (append-only)
- `Warehouse` (depósitos)
- `Location` (endereços dentro do depósito)

**Regras de negócio:**
- `StockBalance` **nunca** fica negativo — validação antes de toda saída
- Toda movimentação exige: origem, destino e motivo
- `SELECT FOR UPDATE` obrigatório ao alterar `StockBalance`
- `StockMovement` é imutável — erros corrigidos com **movimentos de estorno**
- Status de saldo: `disponível`, `reservado`, `bloqueado`, `em trânsito`

---

### Domínio 4 — Compras

> Abastecimento controlado desde a requisição até o recebimento físico.

**Entidades:**
- `PurchaseRequest` (manual ou gerada pelo MRP)
- `PurchaseQuote` (opcional)
- `PurchaseOrder`
- `GoodsReceipt` + `GRItem`
- `SupplierPriceHistory`

**Regras de negócio:**
- Recebimento só é possível com PO aprovada
- Divergência de quantidade exige registro de motivo
- Recebimento gera `StockMovement` automaticamente via evento
- Recebimento gera `FinancialEntry` (conta a pagar) automaticamente
- Lead time do fornecedor alimenta o cálculo do MRP

---

### Domínio 5 — PCP / MRP

> Planejamento de produção e compras baseado em demanda real das lojas e estoque atual.

**Entidades:**
- `Demand` (consolidado das lojas)
- `MrpRun` (snapshot de cada execução)
- `ProductionPlan`
- `ProductionOrder` (sugerida)
- `PurchaseSuggestion`

**Regras de negócio:**
- MRP roda sob demanda (manual) ou agendado (diário via BullMQ)
- Horizonte padrão: **30 dias** (configurável por parâmetro)
- MRP respeita estoque disponível e considera lead time do fornecedor
- Sugestões ficam em status `PENDING` até **aprovação humana**
- Lote mínimo de compra configurável por produto/fornecedor

---

### Domínio 6 — Produção / MES

> Execução das ordens de produção com rastreabilidade de consumo e perdas.

**Entidades:**
- `ProductionOrder`
- `ProductionOperation` (etapas)
- `ProductionLog` (apontamentos)
- `ScrapRecord` (perdas)
- `BatchLot` (rastreabilidade)

**Regras de negócio:**
- Produção não pode iniciar sem OP no status `RELEASED`
- Consumo de matéria-prima gera `StockMovement OUT` automaticamente
- Finalização da OP gera `StockMovement IN` do produto acabado
- Perdas acima do padrão da BOM exigem justificativa obrigatória
- BOM snapshot capturado na **abertura** da OP — alteração de BOM não afeta OPs abertas

---

### Domínio 7 — Logística / WMS

> Organiza o fluxo físico: recebimento, armazenagem, separação e transferência fábrica-loja.

**Entidades:**
- `ReceivingOrder`
- `PutawayTask`
- `PickingOrder`
- `PackingRecord`
- `ShippingOrder`
- `StoreTransfer`

**Regras de negócio:**
- Nada sai do depósito sem picking aprovado
- Transferência fábrica → loja gera estoque `em trânsito` até confirmação pela loja
- Confirmação pela loja: estoque sai de `em trânsito` → `disponível` na loja
- Toda transferência dispara evento → `FiscalModule` emite NF-e via Focus NFe

---

### Domínio 8 — Comercial + Lojas

> Operação de venda nas filiais com estoque em tempo real e integração fiscal automática.

**Entidades:**
- `SalesOrder`
- `SaleItem`
- `StoreTransferRequest`
- `SaleReturn`
- `PriceList` (por filial)

**Regras de negócio:**
- Venda só é confirmada se houver estoque disponível na loja
- Preço pode ser configurado por loja — substitui o preço padrão do produto
- Finalização da venda → evento → `FiscalModule` emite NFC-e ou NF-e
- Devolução retorna ao estoque com motivo obrigatório + gera NF-e de devolução
- Loja pode solicitar transferência de produto à fábrica via interface simplificada

---

### Domínio 9 — Financeiro

> Contas a pagar, contas a receber e fluxo de caixa consolidado. Sem módulo contábil nesta fase.

**Entidades:**
- `FinancialEntry` (CP e CR)
- `BankAccount`
- `CashFlowSnapshot` (visão consolidada)
- `PaymentRecord`

**Regras de negócio:**
- Toda venda finalizada → `FinancialEntry` do tipo `RECEIVABLE` automaticamente
- Todo recebimento de compra → `FinancialEntry` do tipo `PAYABLE` automaticamente
- Fluxo de caixa consolidado por `company` (matriz e filiais separadas e agrupadas)
- Baixa de pagamento exige comprovante (arquivo ou descrição) para auditoria
- Chave NF-e da Focus NFe é armazenada na `FinancialEntry` para rastreabilidade

---

## 8. Roadmap de Desenvolvimento

> Cada sprint tem duração de 2 semanas. O critério de aceite é a condição mínima para considerar o sprint concluído — sem isso, não avança.

### Fase 1 — Core (Sprints 1–10) ✅ Concluída

| Sprint | Módulo | Status |
|---|---|---|
| S01–S03 | Auth, Multi-tenant, Admin | ✅ |
| S04–S06 | Cadastros (Produto, Fornecedor, Cliente, BOM) | ✅ |
| S07–S09 | Estoque + StockBalance concorrência | ✅ |
| S10 | Compras (PO → GoodsReceipt) | ✅ |

### Fase 2 — Fábrica (Sprints 11–16) ✅ Concluída

| Sprint | Módulo | Status |
|---|---|---|
| S11–S13 | MRP Engine + BullMQ | ✅ |
| S14–S15 | Produção / MES (OP, apontamentos) | ✅ |
| S16 | Fiscal (Focus NFe) | ✅ |

### Fase 3 — Logística + Comercial (Sprints 17–24) ✅ Concluída

| Sprint | Módulo | Status |
|---|---|---|
| S17–S20 | WMS (picking, putaway, transferência) | ✅ |
| S21–S24 | Comercial + Lojas + Financeiro | ✅ |

### Estado atual do backend

- **S01–S29 implementados** — 633 testes, 0 falhas
- Auditoria de segurança P0–P3 concluída (14/14 issues)
- CI/CD GitHub Actions ativo
- Sentry integrado
- Score geral: ~96/100

### Fase 4 — Frontend (em andamento)

**64 issues criadas no GitHub Projects (#79–#142)**

| Milestone | Issues | Fase | Domínio |
|---|---|---|---|
| F0 — Fundação | #79–#85 | Fase 0 | Setup (componentes base) |
| F1 — Cadastros | #86–#91 | Fase 1 | Cadastros |
| F2 — Financeiro | #92–#101 | Fase 1 | Financeiro |
| F3 — Comercial | #102–#107 | Fase 1 | Vendas |
| F4 — Compras | #108–#114 | Fase 1 | Compras |
| F5 — Estoque/WMS | #115–#120 | Fase 3 | Estoque |
| F6 — Produção/MRP | #121–#125 | Fase 2 | Produção |
| F7 — Fiscal | #126–#129 | Fase 1 | Fiscal |
| F8 — Qualidade | #130–#132 | Fase 2 | Produção |
| F9 — Manutenção | #133–#135 | Fase 2 | Produção |
| F10 — Analytics | #136–#138 | Fase 4 | Inteligência |
| F-CROSS | #139–#142 | Fase 1 | Auth & Admin |

**Próxima etapa:** Milestone F0 — Fundação (issues #79–#85).

---

## 9. Regras de Governança e Qualidade

### Audit Log

Todo endpoint que faz `CREATE`, `UPDATE` ou `DELETE` deve chamar o `AuditModule` antes de retornar. O interceptor global do NestJS garante isso automaticamente para todos os controllers.

### Convenções de Código

- Toda entidade tem `id (cuid)`, `companyId`, `createdAt` e `updatedAt`
- Nenhum endpoint expõe dados de outra `company`
- DTOs validados com `class-validator` em todo endpoint de escrita
- Erros de negócio usam **exceções tipadas** (ex: `StockInsufficientException`)
- Testes unitários obrigatórios para: engine MRP, custo médio, regras de estoque
- Migration de banco **nunca** faz DROP — apenas `additive changes`

### Segurança

- Rate limiting em todos os endpoints públicos (NestJS Throttler)
- Validação de CNPJ e CPF antes de salvar fornecedor/cliente/empresa
- Certificado digital A1 da Focus NFe armazenado criptografado (AES-256)
- Variáveis sensíveis exclusivamente em variáveis de ambiente
- HTTPS obrigatório em produção; HSTS ativado no reverse proxy

### Backup e Resiliência

- Backup automático diário do PostgreSQL (gerenciado pelo Supabase)
- Retenção mínima de 30 dias de backups
- XMLs de NF-e armazenados no GDR **e** na Focus NFe — conformidade legal 11 anos
- Filas BullMQ com retry automático: 3 tentativas com backoff exponencial
- Sentry alertando para qualquer erro 5xx em produção

---

## 10. Guia de Desenvolvimento com IA

Este documento foi desenhado para ser a **fonte de verdade** em cada sessão de desenvolvimento com IA (Claude Code, Cursor, etc.).

### O que sempre incluir no contexto

- Este PRD (`docs/PRD.md`)
- O schema Prisma do módulo sendo desenvolvido (`apps/api/prisma/schema.prisma`)
- Os eventos de negócio que o módulo emite e consome
- A regra de tenant isolation (`companyId` em todo query)
- O critério de aceite da issue atual

### O que nunca deixar a IA decidir

| Decisão | Razão |
|---|---|
| Nome de tabelas e campos | Definido no PRD — inconsistência quebra o schema |
| Estratégia de lock de estoque | `SELECT FOR UPDATE` — já definida |
| Versionamento de BOM | Imutável após ativação — já definido |
| Integração fiscal | Sempre via `FiscalModule` → Focus NFe, nunca direto |
| Estrutura de eventos | Seguir interface `BusinessEvent` definida aqui |
| Formatação de dados BR | Usar `lib/formatters.ts` — nunca inline |

### Links do projeto

| Recurso | Link |
|---|---|
| Repositório | https://github.com/adminadmin-AI/Avequi |
| Issues & backlog | https://github.com/adminadmin-AI/Avequi |
| Project board | https://github.com/users/adminadmin-AI/projects/7 |
| Vercel (deploy/preview) | https://avequi.vercel.app |
| Supabase | https://supabase.com/dashboard/project/avliarleakraczikvwwz |
| Brandbook | https://avequi-brandbook.vercel.app/ |
| Brandbook (ref. rápida) | [`docs/BRANDBOOK.md`](BRANDBOOK.md) |
