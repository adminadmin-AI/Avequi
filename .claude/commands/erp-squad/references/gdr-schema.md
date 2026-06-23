# GDR — Schema Prisma Completo

> Fonte de verdade do modelo de dados do GDR ERP. Todo agente que gera código deve usar este schema como referência. NUNCA gerar modelos ou campos fora deste schema sem aprovação explícita.

---

## Enums

```prisma
enum CompanyType {
  MATRIX
  BRANCH
}

enum Role {
  DIRECTOR
  FACTORY
  PURCHASE
  FINANCE
  STORE
}

enum ProductType {
  RAW_MATERIAL
  WIP
  FINISHED_GOOD
}

enum MovementType {
  IN
  OUT
  TRANSFER
  ADJUST
  RESERVE
}

enum POStatus {
  DRAFT
  APPROVED
  RECEIVED
  CANCELLED
}

enum POrdStatus {
  PLANNED
  RELEASED
  IN_PROGRESS
  DONE
  CANCELLED
}

enum EntryType {
  PAYABLE
  RECEIVABLE
}

enum EntryStatus {
  OPEN
  PAID
  OVERDUE
  CANCELLED
}
```

---

## Core — Multi-tenant e Autenticação

```prisma
model Company {
  id          String      @id @default(cuid())
  name        String
  cnpj        String      @unique
  type        CompanyType // MATRIX | BRANCH
  parentId    String?     // null = matriz
  active      Boolean     @default(true)
  createdAt   DateTime    @default(now())
  users       User[]
  warehouses  Warehouse[]
}

model User {
  id        String   @id @default(cuid())
  companyId String   // OBRIGATÓRIO — row-level isolation
  email     String   @unique
  name      String
  roleId    String
  active    Boolean  @default(true)
  role      Role     @relation(fields: [roleId], references: [id])
  company   Company  @relation(fields: [companyId], references: [id])
}

model RoleModel {
  id          String       @id @default(cuid())
  name        String       // FACTORY | PURCHASE | FINANCE | STORE | DIRECTOR
  permissions Permission[]
  users       User[]
}

model Permission {
  id     String    @id @default(cuid())
  roleId String
  module String    // "stock" | "sales" | "finance" | "production" etc
  action String    // "read" | "write" | "approve" | "delete"
  role   RoleModel @relation(fields: [roleId], references: [id])
}

model AuditLog {
  // CRÍTICO — todos os writes de negócio passam aqui via interceptor global
  id        String   @id @default(cuid())
  userId    String
  companyId String
  entity    String   // "StockMovement", "PurchaseOrder", "SalesOrder" etc
  entityId  String
  action    String   // CREATE | UPDATE | DELETE
  payload   Json     // diff antes/depois
  createdAt DateTime @default(now())
  // REGRA: NUNCA deletar registros de AuditLog
}

model SystemParameter {
  id        String @id @default(cuid())
  companyId String
  key       String // "mrp_horizon_days" | "min_stock_alert_pct" etc
  value     String
  @@unique([companyId, key])
}
```

---

## Cadastros Mestres

```prisma
model Product {
  id          String        @id @default(cuid())
  companyId   String
  sku         String        @unique
  name        String
  type        ProductType   // RAW_MATERIAL | WIP | FINISHED_GOOD
  unit        String        // "UN" | "KG" | "M" | "L"
  avgCost     Decimal       @default(0) // custo médio ponderado — recalculado em cada recebimento
  ncm         String?       // OBRIGATÓRIO para FINISHED_GOOD (NF-e)
  active      Boolean       @default(true)
  bomVersions BomVersion[]
  // REGRA: ncm obrigatório se type == FINISHED_GOOD
  // REGRA: não pode desativar se houver StockBalance.available > 0 em qualquer warehouse
}

model BomVersion {
  id        String    @id @default(cuid())
  productId String
  version   Int       // auto-incrementa a cada nova versão
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())
  items     BomItem[]
  product   Product   @relation(fields: [productId], references: [id])
  @@unique([productId, version])
  // REGRA: versão ativa nunca pode ser editada — apenas nova versão
  // REGRA: ao criar nova versão, desativar a versão atual automaticamente
  // REGRA: ProductionOrder captura bomVersionId na abertura — snapshot imutável
}

model BomItem {
  id           String     @id @default(cuid())
  bomVersionId String
  componentId  String     // Product (matéria-prima ou WIP)
  quantity     Decimal
  scrapPct     Decimal    @default(0) // % perda padrão (ex: 0.05 = 5%)
  bomVersion   BomVersion @relation(fields: [bomVersionId], references: [id])
  component    Product    @relation("ComponentOf", fields: [componentId], references: [id])
}

model RoutingStep {
  id           String     @id @default(cuid())
  bomVersionId String
  stepOrder    Int
  workCenter   String     // "MONTAGEM" | "PINTURA" | "CORTE" etc
  timeMinutes  Decimal    // tempo padrão em minutos
  bomVersion   BomVersion @relation(fields: [bomVersionId], references: [id])
}

model Supplier {
  id           String          @id @default(cuid())
  companyId    String
  name         String
  cnpj         String
  leadTimeDays Int             @default(7) // alimenta o MRP
  active       Boolean         @default(true)
  priceHistory SupplierPrice[]
}

model SupplierPrice {
  id         String   @id @default(cuid())
  supplierId String
  productId  String
  price      Decimal
  minQty     Decimal  @default(1) // lote mínimo de compra
  validFrom  DateTime
  supplier   Supplier @relation(fields: [supplierId], references: [id])
}

model Customer {
  id        String  @id @default(cuid())
  companyId String
  name      String
  cpfCnpj   String
  type      String  // "PF" | "PJ"
  email     String?
  phone     String?
  active    Boolean @default(true)
}
```

---

## Estoque

```prisma
model Warehouse {
  id        String     @id @default(cuid())
  companyId String
  name      String
  type      String     // "FACTORY" | "STORE" | "TRANSIT"
  active    Boolean    @default(true)
  locations Location[]
  company   Company    @relation(fields: [companyId], references: [id])
}

model Location {
  id          String    @id @default(cuid())
  warehouseId String
  code        String    // ex: "A-01-01" (corredor-prateleira-posição)
  active      Boolean   @default(true)
  warehouse   Warehouse @relation(fields: [warehouseId], references: [id])
  @@unique([warehouseId, code])
}

model StockBalance {
  id          String    @id @default(cuid())
  companyId   String
  warehouseId String
  productId   String
  available   Decimal   @default(0)
  reserved    Decimal   @default(0)  // reservado por OV não confirmada
  blocked     Decimal   @default(0)  // bloqueado por qualidade
  inTransit   Decimal   @default(0)  // em trânsito fábrica→loja
  updatedAt   DateTime  @updatedAt
  @@unique([warehouseId, productId])
  // REGRA CRÍTICA: toda alteração exige SELECT FOR UPDATE em transação Prisma
  // REGRA: available NUNCA pode ser negativo
  // total implícito = available + reserved + blocked + inTransit
}

model StockMovement {
  // APPEND-ONLY — NUNCA deletar ou atualizar registros
  id            String      @id @default(cuid())
  companyId     String
  productId     String
  warehouseId   String
  type          MovementType // IN | OUT | TRANSFER | ADJUST | RESERVE
  quantity      Decimal      // positivo = entrada, negativo = saída
  reason        String       // motivo OBRIGATÓRIO
  referenceId   String?      // id da entidade que originou (PO, OV, OP)
  referenceType String?      // "PurchaseOrder" | "SalesOrder" | "ProductionOrder"
  userId        String       // OBRIGATÓRIO — rastreabilidade
  locationId    String?      // endereço dentro do depósito (WMS fase 3)
  createdAt     DateTime     @default(now())
  // REGRA: erros são corrigidos com movimento de estorno (quantidade inversa)
}
```

---

## Compras

```prisma
model PurchaseOrder {
  id          String         @id @default(cuid())
  companyId   String
  supplierId  String
  status      POStatus       // DRAFT | APPROVED | RECEIVED | CANCELLED
  expectedAt  DateTime
  items       POItem[]
  receipts    GoodsReceipt[]
  createdAt   DateTime       @default(now())
  // REGRA: recebimento só possível com status = APPROVED
}

model POItem {
  id              String        @id @default(cuid())
  purchaseOrderId String
  productId       String
  quantity        Decimal
  unitPrice       Decimal
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id])
}

model GoodsReceipt {
  id              String        @id @default(cuid())
  poId            String
  warehouseId     String
  receivedAt      DateTime
  items           GRItem[]
  purchaseOrder   PurchaseOrder @relation(fields: [poId], references: [id])
  // Evento emitido: "purchase.goods_received" → StockModule + FinanceModule
}

model GRItem {
  id             String       @id @default(cuid())
  goodsReceiptId String
  productId      String
  quantityOrdered Decimal
  quantityReceived Decimal
  divergenceReason String?   // obrigatório se quantityReceived != quantityOrdered
  goodsReceipt   GoodsReceipt @relation(fields: [goodsReceiptId], references: [id])
}

model PurchaseRequest {
  id          String   @id @default(cuid())
  companyId   String
  productId   String
  quantity    Decimal
  neededBy    DateTime
  source      String   // "MANUAL" | "MRP"
  mrpRunId    String?  // se gerado pelo MRP
  status      String   // "PENDING" | "CONVERTED" | "REJECTED"
  createdAt   DateTime @default(now())
}
```

---

## MRP / PCP

```prisma
model Demand {
  id          String   @id @default(cuid())
  companyId   String
  warehouseId String   // loja que gerou a demanda
  productId   String
  quantity    Decimal
  neededBy    DateTime
  source      String   // "MANUAL" | "SALES_FORECAST" | "HISTORICAL"
  createdAt   DateTime @default(now())
}

model MrpRun {
  // Snapshot imutável de cada execução
  id          String   @id @default(cuid())
  companyId   String
  horizon     Int      // dias à frente (padrão: 30, configurável via SystemParameter)
  ranAt       DateTime @default(now())
  ranBy       String   // userId — "SYSTEM" se agendado
  suggestions Json     // { productionOrders: [...], purchaseRequests: [...] }
  status      String   // "PENDING" | "APPLIED" | "DISCARDED"
}

model ProductionPlan {
  id          String   @id @default(cuid())
  companyId   String
  mrpRunId    String?
  productId   String
  quantity    Decimal
  plannedFor  DateTime
  status      String   // "SUGGESTED" | "APPROVED" | "CONVERTED"
}
```

---

## Produção / MES

```prisma
model ProductionOrder {
  id           String               @id @default(cuid())
  companyId    String
  productId    String
  bomVersionId String               // BOM snapshot — capturado na abertura, imutável
  quantity     Decimal
  status       POrdStatus           // PLANNED | RELEASED | IN_PROGRESS | DONE | CANCELLED
  plannedDate  DateTime
  operations   ProductionOperation[]
  logs         ProductionLog[]
  scrapRecords ScrapRecord[]
  // REGRA: só pode liberar (RELEASED) se houver estoque de MP suficiente
  // REGRA: BOM snapshot — alterações na BOM não afetam OPs abertas
}

model ProductionOperation {
  id                String          @id @default(cuid())
  productionOrderId String
  routingStepId     String
  status            String          // "PENDING" | "IN_PROGRESS" | "DONE"
  startedAt         DateTime?
  completedAt       DateTime?
  productionOrder   ProductionOrder @relation(fields: [productionOrderId], references: [id])
}

model ProductionLog {
  // Apontamento de produção — cada registro de quantidade produzida
  id                String          @id @default(cuid())
  productionOrderId String
  operationId       String?
  quantity          Decimal
  userId            String
  loggedAt          DateTime        @default(now())
  productionOrder   ProductionOrder @relation(fields: [productionOrderId], references: [id])
}

model ScrapRecord {
  id                String          @id @default(cuid())
  productionOrderId String
  productId         String          // material perdido
  quantity          Decimal
  reason            String          // OBRIGATÓRIO se > scrapPct padrão da BOM
  userId            String
  createdAt         DateTime        @default(now())
  productionOrder   ProductionOrder @relation(fields: [productionOrderId], references: [id])
}

model BatchLot {
  id                String   @id @default(cuid())
  productId         String
  productionOrderId String?
  lotNumber         String   @unique
  quantity          Decimal
  producedAt        DateTime
}
```

---

## Logística / WMS

```prisma
model StoreTransfer {
  id              String    @id @default(cuid())
  companyId       String
  fromWarehouseId String    // fábrica / origem
  toWarehouseId   String    // loja / destino
  status          String    // "PENDING" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED"
  nfeKey          String?   // chave NF-e CFOP 5152 gerada pela Focus NFe
  requestedAt     DateTime  @default(now())
  shippedAt       DateTime?
  receivedAt      DateTime?
  items           StoreTransferItem[]
  // REGRA: ao enviar → gera StockMovement OUT (fábrica) + inTransit++ (loja)
  // REGRA: ao confirmar recebimento → inTransit-- + available++ (loja)
  // REGRA: toda transferência dispara evento para FiscalModule emitir NF-e CFOP 5152
}

model StoreTransferItem {
  id              String        @id @default(cuid())
  transferId      String
  productId       String
  quantity        Decimal
  storeTransfer   StoreTransfer @relation(fields: [transferId], references: [id])
}

model PickingOrder {
  id          String   @id @default(cuid())
  companyId   String
  salesOrderId String?
  warehouseId String
  status      String   // "PENDING" | "IN_PROGRESS" | "DONE"
  createdAt   DateTime @default(now())
  items       PickingItem[]
  // REGRA: item só sai do depósito após confirmação de conferência
}

model PickingItem {
  id            String       @id @default(cuid())
  pickingOrderId String
  productId     String
  locationId    String?
  quantityRequested Decimal
  quantityPicked    Decimal  @default(0)
  pickingOrder  PickingOrder @relation(fields: [pickingOrderId], references: [id])
}
```

---

## Comercial / Lojas

```prisma
model SalesOrder {
  id          String     @id @default(cuid())
  companyId   String     // filial/loja
  customerId  String?
  status      String     // "DRAFT" | "CONFIRMED" | "INVOICED" | "CANCELLED"
  total       Decimal
  nfeKey      String?    // chave NF-e retornada pela Focus NFe
  nfceKey     String?    // chave NFC-e (venda direta ao consumidor)
  createdAt   DateTime   @default(now())
  items       SaleItem[]
  returns     SaleReturn[]
  // REGRA: confirmar só se available >= quantidade em todos os itens
  // REGRA: ao confirmar → reservar estoque (RESERVE movement)
  // REGRA: ao faturar → StockMovement OUT + emitir NF-e ou NFC-e via FiscalModule
}

model SaleItem {
  id           String     @id @default(cuid())
  salesOrderId String
  productId    String
  quantity     Decimal
  unitPrice    Decimal
  total        Decimal
  salesOrder   SalesOrder @relation(fields: [salesOrderId], references: [id])
}

model SaleReturn {
  id           String     @id @default(cuid())
  salesOrderId String
  productId    String
  quantity     Decimal
  reason       String     // OBRIGATÓRIO
  nfeKey       String?    // NF-e de devolução CFOP 1201
  returnedAt   DateTime   @default(now())
  salesOrder   SalesOrder @relation(fields: [salesOrderId], references: [id])
  // REGRA: gera StockMovement IN de volta à loja
}

model PriceList {
  id          String   @id @default(cuid())
  companyId   String   // filial específica
  productId   String
  price       Decimal  // substitui o preço padrão do produto para esta filial
  validFrom   DateTime
  validUntil  DateTime?
  @@unique([companyId, productId, validFrom])
}
```

---

## Financeiro

```prisma
model FinancialEntry {
  id            String      @id @default(cuid())
  companyId     String
  type          EntryType   // PAYABLE | RECEIVABLE
  amount        Decimal
  dueDate       DateTime
  paidAt        DateTime?
  status        EntryStatus // OPEN | PAID | OVERDUE | CANCELLED
  referenceId   String      // SalesOrder.id ou PurchaseOrder.id
  referenceType String      // "SalesOrder" | "PurchaseOrder"
  nfeKey        String?     // chave NF-e da Focus NFe — rastreabilidade fiscal
  // REGRA: gerada automaticamente por evento (não criar manualmente)
  // PAYABLE → criada pelo evento "purchase.goods_received"
  // RECEIVABLE → criada pelo evento "sales.order.invoiced"
}

model PaymentRecord {
  id               String         @id @default(cuid())
  financialEntryId String
  amount           Decimal
  paidAt           DateTime
  evidence         String?        // arquivo ou descrição — OBRIGATÓRIO para auditoria
  userId           String
  financialEntry   FinancialEntry @relation(fields: [financialEntryId], references: [id])
}

model BankAccount {
  id        String   @id @default(cuid())
  companyId String
  name      String
  bank      String
  agency    String
  account   String
  balance   Decimal  @default(0)
  active    Boolean  @default(true)
}

model CashFlowSnapshot {
  id          String   @id @default(cuid())
  companyId   String
  date        DateTime
  inflow      Decimal  // total entradas previstas
  outflow     Decimal  // total saídas previstas
  balance     Decimal  // saldo projetado
  generatedAt DateTime @default(now())
}
```

---

## Padrão de Evento (BusinessEvent)

Todo evento inter-módulo deve seguir esta estrutura:

```typescript
interface BusinessEvent<T> {
  eventType: string;   // ex: "sales.order.invoiced"
  companyId: string;
  userId:    string;
  entityId:  string;
  payload:   T;
  occurredAt: Date;
}
```

### Catálogo de Eventos Críticos

| Evento | Emitido por | Ouvido por |
|--------|-------------|------------|
| `purchase.goods_received` | PurchaseModule | StockModule, FinanceModule |
| `sales.order.confirmed` | SalesModule | StockModule (reserva) |
| `sales.order.invoiced` | SalesModule | StockModule (baixa), FinanceModule, FiscalModule |
| `sales.order.returned` | SalesModule | StockModule (entrada), FiscalModule |
| `transfer.shipped` | LogisticsModule | StockModule (saída fábrica + inTransit loja) |
| `transfer.received` | LogisticsModule | StockModule (inTransit→available loja), FiscalModule |
| `production.order.released` | ProductionModule | StockModule (reserva MP) |
| `production.order.completed` | ProductionModule | StockModule (entrada PA + saída MP) |
| `mrp.run.completed` | MrpModule | — (usuário aprova manualmente) |
