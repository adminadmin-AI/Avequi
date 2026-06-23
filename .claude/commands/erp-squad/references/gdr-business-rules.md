# GDR — Regras de Negócio Críticas

> Regras obrigatórias que todo agente deve conhecer antes de gerar código para o GDR. Violar qualquer regra marcada como CRÍTICA causa bugs que chegam a produção com dados corrompidos ou multa fiscal.

---

## Regras Globais (todos os módulos)

| # | Regra | Severidade |
|---|-------|------------|
| G1 | **Todo write de negócio gera AuditLog** — via interceptor global do NestJS | CRÍTICA |
| G2 | **Todo query filtra por `companyId`** — sem exceção. Nunca retornar dados de outra company | CRÍTICA |
| G3 | **Usuário STORE só acessa dados da própria filial** — guard verifica `user.companyId === resource.companyId` | CRÍTICA |
| G4 | **AuditLog é append-only** — nunca deletar ou atualizar registros | CRÍTICA |
| G5 | **DIRECTOR tem acesso cross-company dentro do grupo** (matriz + filiais) | ALTA |
| G6 | **Access Token**: 15 min. **Refresh Token**: 7 dias com rotação a cada uso | ALTA |
| G7 | **JWT payload obrigatório**: `{ sub: userId, companyId, role, iat, exp }` | CRÍTICA |

---

## Domínio 1 — Administração

| # | Regra | Severidade |
|---|-------|------------|
| A1 | Todo usuário pertence a exatamente **uma company** — nunca null | CRÍTICA |
| A2 | Alterações em `SystemParameter` exigem perfil **DIRECTOR** | ALTA |
| A3 | Desativar usuário não deleta — `active = false` | MÉDIA |
| A4 | CNPJ da company é `@unique` — validar formato antes de salvar | ALTA |

---

## Domínio 2 — Cadastros Mestres

| # | Regra | Severidade |
|---|-------|------------|
| C1 | **NCM é obrigatório** para produtos com `type = FINISHED_GOOD` — sem NCM, NF-e é rejeitada pela SEFAZ | CRÍTICA |
| C2 | **BOM versão ativa nunca pode ser editada** — qualquer alteração cria nova versão (`version + 1`) e desativa a atual | CRÍTICA |
| C3 | **Produto com estoque > 0** em qualquer depósito não pode ser desativado | ALTA |
| C4 | **Custo médio ponderado** recalculado automaticamente a cada recebimento de compra: `newAvgCost = (currentStock * currentAvgCost + receivedQty * unitPrice) / (currentStock + receivedQty)` | CRÍTICA |
| C5 | `sku` é `@unique` global — não por company | ALTA |
| C6 | `scrapPct` na BomItem é fator, não percentual: `0.05 = 5% de perda` | MÉDIA |

---

## Domínio 3 — Estoque

| # | Regra | Severidade |
|---|-------|------------|
| E1 | **`StockBalance.available` NUNCA pode ser negativo** — validar antes de qualquer OUT | CRÍTICA |
| E2 | **SELECT FOR UPDATE obrigatório** ao alterar StockBalance — sempre dentro de transação Prisma (`prisma.$transaction`) | CRÍTICA |
| E3 | **StockMovement é append-only** — nunca deletar ou atualizar. Erros são corrigidos com movimento de estorno (quantidade inversa) | CRÍTICA |
| E4 | Todo StockMovement exige: `reason` (motivo), `userId`, `productId`, `warehouseId` | CRÍTICA |
| E5 | `quantity` positivo = entrada, negativo = saída | ALTA |
| E6 | Transferência fábrica→loja: `available--` na fábrica, `inTransit++` na loja. Confirmação de recebimento: `inTransit--`, `available++` na loja | CRÍTICA |
| E7 | Reserva de estoque (OV confirmada): `available--`, `reserved++`. Baixa efetiva: `reserved--` | ALTA |
| E8 | `total = available + reserved + blocked + inTransit` — nunca armazenar total, calcular quando necessário | MÉDIA |

---

## Domínio 4 — Compras

| # | Regra | Severidade |
|---|-------|------------|
| P1 | **Recebimento exige PO com status `APPROVED`** — rejeitar se status != APPROVED | CRÍTICA |
| P2 | **Divergência de quantidade** entre PO e recebimento exige `divergenceReason` obrigatório | ALTA |
| P3 | **Recebimento gera StockMovement automaticamente** via evento `purchase.goods_received` | CRÍTICA |
| P4 | **Recebimento gera FinancialEntry (PAYABLE)** automaticamente via evento `purchase.goods_received` | CRÍTICA |
| P5 | **Custo médio** do produto é recalculado após cada `GoodsReceipt` (ver regra C4) | CRÍTICA |
| P6 | `leadTimeDays` do fornecedor alimenta o cálculo do MRP — manter atualizado | ALTA |

---

## Domínio 5 — MRP / PCP

| # | Regra | Severidade |
|---|-------|------------|
| M1 | **MRP sugestões ficam em status PENDING** — nunca converter automaticamente em OP ou PO sem aprovação humana | CRÍTICA |
| M2 | **Horizonte padrão: 30 dias** — configurável via `SystemParameter` com key `mrp_horizon_days` | ALTA |
| M3 | MRP considera: demanda consolidada das lojas + estoque disponível atual + lead time do fornecedor + BOM explodida | CRÍTICA |
| M4 | **Lote mínimo de compra** (`SupplierPrice.minQty`) deve ser respeitado nas sugestões de compra | ALTA |
| M5 | **MRP snapshot imutável** — `MrpRun.suggestions` é JSON com estado no momento do cálculo | ALTA |
| M6 | `scrapPct` da BOM é aplicado na explosão: `qtyNeeded = qtyToProduced * componentQty * (1 + scrapPct)` | ALTA |
| M7 | MRP pode rodar manualmente ou via BullMQ (cron diário) — ambos criam `MrpRun` | MÉDIA |

### Algoritmo MRP — Fluxo Obrigatório

```
Para cada produto com demanda no horizonte:
  1. netRequirement = demandaTotal - stockDisponivel
  2. Se netRequirement <= 0: sem ação (estoque suficiente)
  3. Se netRequirement > 0:
     a. Explodir BOM: para cada componente, calcular qty * (1 + scrapPct)
     b. Calcular data de início = dataEntrega - leadTimeDias
     c. Verificar estoque de MP disponível
     d. Gerar ProductionPlan (OP sugerida) para o produto pai
     e. Gerar PurchaseRequest (compra sugerida) para MPs em falta
  4. Salvar tudo em MrpRun.suggestions como JSON
  5. Status = PENDING aguardando aprovação
```

---

## Domínio 6 — Produção / MES

| # | Regra | Severidade |
|---|-------|------------|
| PR1 | **OP só pode ser liberada (RELEASED)** se houver estoque de todas as matérias-primas suficiente | CRÍTICA |
| PR2 | **BOM snapshot** capturado na abertura da OP — `bomVersionId` é imutável após criação | CRÍTICA |
| PR3 | **Consumo de MP** gera StockMovement OUT automaticamente ao apontar produção | CRÍTICA |
| PR4 | **Finalização da OP** gera StockMovement IN do produto acabado | CRÍTICA |
| PR5 | **Perda acima do padrão** da BOM (`scrapPct`) exige `reason` obrigatório no ScrapRecord | ALTA |
| PR6 | Custo da OP finalizada = `Σ (MP consumida * avgCost)` — atualiza avgCost do produto acabado | ALTA |
| PR7 | OP cancelada: estornar reservas de MP se houver (StockMovement de estorno) | ALTA |

---

## Domínio 7 — Logística / WMS

| # | Regra | Severidade |
|---|-------|------------|
| L1 | **Nada sai do depósito sem PickingOrder aprovada** | ALTA |
| L2 | **Transferência fábrica→loja emite NF-e CFOP 5152** via FiscalModule automaticamente | CRÍTICA |
| L3 | **Estoque em trânsito** (`inTransit`) existe entre envio e confirmação de recebimento pela loja | CRÍTICA |
| L4 | Confirmação de recebimento da loja: `inTransit--` + `available++` na loja | CRÍTICA |
| L5 | Item recebido no WMS deve ser endereçado (putaway) antes de ficar disponível para picking | MÉDIA |

---

## Domínio 8 — Comercial / Lojas

| # | Regra | Severidade |
|---|-------|------------|
| V1 | **Venda só confirmada se `available >= quantidade`** em todos os itens da OV | CRÍTICA |
| V2 | **Confirmação → reserva de estoque**: `available--`, `reserved++` por item | CRÍTICA |
| V3 | **Faturamento → baixa efetiva + emissão fiscal**: StockMovement OUT + NFC-e (consumidor) ou NF-e (PJ) via FiscalModule | CRÍTICA |
| V4 | **Devolução**: StockMovement IN + NF-e CFOP 1201 + `reason` obrigatório | ALTA |
| V5 | **Preço por loja** (`PriceList`) substitui o preço padrão do produto quando vigente | ALTA |
| V6 | NF-e para venda PJ: CFOP 5101 (produto industrializado) ou 5409 (produto adquirido de terceiros) | CRÍTICA |
| V7 | NFC-e para venda ao consumidor final (CPF) | ALTA |

---

## Domínio 9 — Financeiro

| # | Regra | Severidade |
|---|-------|------------|
| F1 | **RECEIVABLE gerada automaticamente** pelo evento `sales.order.invoiced` — nunca criar manualmente | CRÍTICA |
| F2 | **PAYABLE gerada automaticamente** pelo evento `purchase.goods_received` — nunca criar manualmente | CRÍTICA |
| F3 | **Baixa de pagamento exige evidência** — `PaymentRecord.evidence` obrigatório (arquivo ou descrição) | ALTA |
| F4 | **Chave NF-e** (`nfeKey`) armazenada na `FinancialEntry` para rastreabilidade fiscal | ALTA |
| F5 | Fluxo de caixa consolidado por company — matriz e filiais separadas e agrupadas | MÉDIA |
| F6 | `FinancialEntry.status` OVERDUE: cron diário verifica `dueDate < now()` e `status = OPEN` | MÉDIA |

---

## Fiscal — Focus NFe

| # | Regra | Severidade |
|---|-------|------------|
| FI1 | **GDR nunca emite NF-e diretamente** — sempre via Focus NFe API REST | CRÍTICA |
| FI2 | **Chave de acesso** retornada pela Focus NFe deve ser armazenada no registro que originou | CRÍTICA |
| FI3 | **Webhook de retorno** da Focus NFe deve atualizar status para "faturado" automaticamente | ALTA |
| FI4 | **CFOPs corretos**: 5101/5409 (venda), 5152 (transferência saída), 1152 (transferência entrada), 1201 (devolução) | CRÍTICA |
| FI5 | **NCM obrigatório** em todos os itens da NF-e — validar antes de montar payload | CRÍTICA |
| FI6 | Contingência SEFAZ é automática pela Focus NFe — sistema não precisa implementar | BAIXA |

---

## Padrões de Código Obrigatórios

```typescript
// PADRÃO 1 — Toda alteração de StockBalance
async function updateStock(prisma: PrismaClient, warehouseId: string, productId: string, delta: Decimal) {
  await prisma.$transaction(async (tx) => {
    // SELECT FOR UPDATE — nunca pular este passo
    const balance = await tx.$queryRaw`
      SELECT * FROM "StockBalance"
      WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId}
      FOR UPDATE
    `;
    const newAvailable = balance.available + delta;
    if (newAvailable < 0) throw new Error('Insufficient stock');
    await tx.stockBalance.update({ where: { id: balance.id }, data: { available: newAvailable } });
    await tx.stockMovement.create({ data: { /* ... */ } });
  });
}

// PADRÃO 2 — Todo controller/service filtra por companyId
async findAll(companyId: string) {
  return this.prisma.product.findMany({ where: { companyId } });
  // NUNCA: this.prisma.product.findMany() — sem filtro
}

// PADRÃO 3 — Todo evento de negócio
this.events.emit('sales.order.invoiced', {
  eventType: 'sales.order.invoiced',
  companyId, userId, entityId: order.id,
  payload: { orderId: order.id, total: order.total },
  occurredAt: new Date(),
} satisfies BusinessEvent<OrderPayload>);
```
