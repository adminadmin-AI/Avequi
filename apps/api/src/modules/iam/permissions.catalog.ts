/**
 * Catálogo de permissões do IAM v2 — issue #338 (Fase F2/M1).
 *
 * ESTE ARQUIVO É A FONTE DA VERDADE do catálogo de permissões (Decisão 2 da
 * arquitetura, docs/iam/ARQUITETURA-IAM-V2.md): o catálogo é VERSIONADO EM
 * CÓDIGO e gera o seed idempotente (prisma/seeds/iam.seed.ts). O banco nunca
 * inventa permissão que o código não conhece; os vínculos (perfil ↔ permissão,
 * usuário ↔ perfil) são dados vivos no banco.
 *
 * Formato do code: `modulo.recurso.acao` (ex.: `sales.orders.create`).
 *
 * REGRA DE OURO: cada permissão aqui corresponde a pelo menos um endpoint REAL
 * de um controller em `src/modules/**`. Nenhuma permissão foi inventada para
 * endpoint que não existe. Quando um endpoint novo nascer, a permissão nasce
 * junto, aqui, no mesmo PR.
 *
 * Módulo `iam` (auditoria/segurança): entrou na F5.1 (#341), junto com o
 * PermissionGuard — o endpoint GET /iam/audit-logs nasceu na #343 e é a
 * primeira rota com enforcement @RequirePermission (dogfooding).
 */

export interface PermissionDef {
  /** `modulo.recurso.acao` — único no catálogo */
  code: string;
  /** Nome legível em pt-BR (ex.: "Pedidos de venda — criar") */
  name: string;
  description?: string;
  module: string;
  resource: string;
  action: string;
}

/** Regex oficial de um code válido (cada segmento: kebab-case minúsculo) */
export const PERMISSION_CODE_REGEX =
  /^[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*\.[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

type ActionTuple = [action: string, actionLabel: string, description?: string];

/** Constrói as permissões de um recurso: `r('sales','orders','Pedidos de venda', [...])` */
function r(
  module: string,
  resource: string,
  resourceLabel: string,
  actions: ActionTuple[],
): PermissionDef[] {
  return actions.map(([action, actionLabel, description]) => ({
    code: `${module}.${resource}.${action}`,
    name: `${resourceLabel} — ${actionLabel}`,
    description,
    module,
    resource,
    action,
  }));
}

// ─── Catálogo ────────────────────────────────────────────────────────────────
// Comentários indicam o(s) controller(s)/endpoint(s) reais cobertos.

export const PERMISSIONS_CATALOG: PermissionDef[] = [
  // ── dashboard ── (dashboard.controller.ts + alert.controller.ts)
  ...r('dashboard', 'executive', 'Dashboard executivo', [['view', 'ver', 'GET /dashboard/executive']]),
  ...r('dashboard', 'sales', 'Dashboard de vendas', [['view', 'ver', 'GET /dashboard/sales']]),
  ...r('dashboard', 'finance', 'Dashboard financeiro', [['view', 'ver', 'GET /dashboard/finance (leitura restrita 🔒)']]),
  ...r('dashboard', 'production', 'Dashboard de produção', [['view', 'ver', 'GET /dashboard/production']]),
  ...r('dashboard', 'stock', 'Dashboard de estoque', [['view', 'ver', 'GET /dashboard/stock']]),
  ...r('dashboard', 'purchases', 'Dashboard de compras', [['view', 'ver', 'GET /dashboard/purchases']]),
  ...r('dashboard', 'alerts', 'Alertas', [
    ['view', 'ver', 'GET /alerts, GET /alerts/all'],
    ['check', 'rodar checagem', 'POST /alerts/check'],
    ['resolve', 'resolver', 'PATCH /alerts/:id/resolve'],
  ]),

  // ── analytics ── (analytics.controller.ts + report.controller.ts)
  ...r('analytics', 'dashboards', 'Painéis analíticos', [
    ['view', 'ver', 'GET /analytics/* (summary, sales-cube, inventory-aging, production-costs, purchases, stock-turnover, supplier-ranking, nc-by-supplier)'],
  ]),
  ...r('analytics', 'reports', 'Relatórios', [
    ['view', 'ver', 'GET /reports/aging, /reports/purchases-by-supplier, /reports/:jobId/status, /reports/:jobId/download'],
    ['create', 'gerar (jobs assíncronos)', 'POST /reports/cost-history, /reports/stock-abc, /reports/production-efficiency'],
  ]),
  ...r('analytics', 'export', 'Exportações', [
    ['execute', 'exportar dados', 'GET /reports/export/* (products, customers, suppliers, sales, purchases, stock)'],
  ]),

  // ── products ── (product.controller.ts + price.controller.ts)
  ...r('products', 'catalog', 'Produtos', [
    ['view', 'ver', 'GET /products, GET /products/:id'],
    ['create', 'criar', 'POST /products'],
    ['update', 'editar', 'PATCH /products/:id'],
  ]),
  ...r('products', 'pricing', 'Preços', [
    ['view', 'ver', 'GET /prices, GET /prices/lookup, GET /prices/:id'],
    ['create', 'criar', 'POST /prices'],
  ]),

  // ── customers ── (customer.controller.ts)
  ...r('customers', 'registry', 'Clientes', [
    ['view', 'ver', 'GET /customers, GET /customers/:id, GET /customers/:id/credit'],
    ['create', 'criar', 'POST /customers'],
    ['update', 'editar', 'PATCH /customers/:id'],
  ]),
  // Endereço de entrega tem regra própria (decisão Rafael, #620): a loja/balcão
  // ADICIONA endereço na venda, mas não edita nem remove — por isso a família
  // é separada de customers.registry.update em vez de reutilizá-lo.
  ...r('customers', 'addresses', 'Endereços de entrega do cliente', [
    ['create', 'adicionar', 'POST /customers/:id/addresses'],
    ['update', 'editar', 'PATCH /customers/:id/addresses/:addressId'],
    ['delete', 'remover', 'DELETE /customers/:id/addresses/:addressId'],
  ]),

  // ── suppliers ── (supplier.controller.ts + supplier-portal.controller.ts, rotas de token)
  ...r('suppliers', 'registry', 'Fornecedores', [
    ['view', 'ver', 'GET /suppliers, GET /suppliers/:id'],
    ['create', 'criar', 'POST /suppliers'],
    ['update', 'editar', 'PATCH /suppliers/:id'],
  ]),
  ...r('suppliers', 'portal-tokens', 'Tokens do portal do fornecedor', [
    ['view', 'ver', 'GET /supplier-portal/tokens'],
    ['create', 'criar', 'POST /supplier-portal/tokens'],
    ['revoke', 'revogar', 'PATCH /supplier-portal/tokens/:id/revoke'],
  ]),

  // ── sales ── (sales, quotation, commission, demand, forecast controllers)
  ...r('sales', 'orders', 'Pedidos de venda', [
    ['view', 'ver', 'GET /sales, GET /sales/:id'],
    ['create', 'criar', 'POST /sales'],
    ['reserve', 'reservar estoque', 'PATCH /sales/:id/reserve'],
    ['confirm', 'confirmar', 'PATCH /sales/:id/confirm'],
    ['invoice', 'faturar (emite NF-e)', 'PATCH /sales/:id/invoice'],
    ['return', 'registrar devolução', 'PATCH /sales/:id/return'],
    ['cancel', 'cancelar', 'PATCH /sales/:id/cancel'],
    // #621 (PR C): rotas do fluxo de venda criadas depois do catálogo original
    ['set-payments', 'definir plano de pagamento', 'PATCH /sales/:id/payments (#584)'],
    ['authorize-cards', 'autorizar cartões no TEF/gateway', 'POST /sales/:id/authorize (#596)'],
    ['confer', 'conferir carga separada', 'POST /sales/:id/conference (#491)'],
  ]),
  // Alçadas de desconto (#391) — configurar é gestão comercial, não diretoria
  // (decisão Rafael #621: DIRETOR vê, não configura).
  ...r('sales', 'discount-policies', 'Alçadas de desconto', [
    ['view', 'ver', 'GET /sales/discount-policies'],
    ['configure', 'configurar', 'POST /sales/discount-policies/seed-defaults, PATCH /sales/discount-policies/:id'],
  ]),
  // #625 (bloco G): cadastro de transportadoras — a leitura estava aberta a
  // qualquer autenticado (carrier.controller sem gate nos GETs).
  ...r('sales', 'carriers', 'Transportadoras', [
    ['view', 'ver', 'GET /carriers, GET /carriers/:id'],
    ['manage', 'criar/editar', 'POST /carriers, PATCH /carriers/:id'],
  ]),
  // #625 (bloco G): entregas pós-NF-e (#365) — update muda status de entrega
  // real (expedição/loja); FINANCEIRO só acompanha (view), decisão Rafael.
  ...r('sales', 'deliveries', 'Entregas (pós-NF-e)', [
    ['view', 'ver', 'GET /deliveries'],
    ['update', 'atualizar status', 'PATCH /deliveries/:id/status'],
  ]),
  ...r('sales', 'quotations', 'Orçamentos', [
    ['view', 'ver', 'GET /quotations, GET /quotations/stats, GET /quotations/:id'],
    ['create', 'criar', 'POST /quotations'],
    ['update', 'editar', 'PATCH /quotations/:id'],
    ['delete', 'excluir', 'DELETE /quotations/:id'],
    ['send', 'enviar ao cliente', 'PATCH /quotations/:id/send'],
    ['approve', 'aprovar (aceite do cliente)', 'PATCH /quotations/:id/approve'],
    ['reject', 'rejeitar', 'PATCH /quotations/:id/reject'],
    ['convert', 'converter em pedido', 'PATCH /quotations/:id/convert'],
    ['expire', 'expirar', 'PATCH /quotations/:id/expire'],
  ]),
  ...r('sales', 'commissions', 'Comissões', [
    ['view', 'ver', 'GET /commissions, GET /commissions/rules (leitura restrita 🔒)'],
    ['approve', 'aprovar lote', 'POST /commissions/approve-batch'],
    ['configure', 'configurar regras', 'POST /commissions/rules'],
  ]),
  ...r('sales', 'demand', 'Previsão de demanda', [
    ['view', 'ver', 'GET /demand, /demand/consolidated, /demand/history/:productId, /demand/suggestions'],
    ['create', 'criar', 'POST /demand'],
    ['delete', 'excluir', 'DELETE /demand/:id'],
    ['configure', 'configurar horizonte MRP', 'PATCH /demand/horizon'],
  ]),
  ...r('sales', 'forecast', 'Forecast', [
    ['view', 'ver', 'GET /forecast, /forecast/backtest, /forecast/history/:productId'],
    ['generate', 'gerar', 'POST /forecast/generate'],
    ['adjust', 'ajustar', 'PATCH /forecast/:id/adjust'],
  ]),

  // ── purchases ── (purchase, rfq, inbound-nfe controllers)
  ...r('purchases', 'orders', 'Pedidos de compra', [
    ['view', 'ver', 'GET /purchase/orders, GET /purchase/orders/:id, /purchase/orders/:id/receiving-status'],
    ['create', 'criar', 'POST /purchase/orders'],
    ['update', 'editar', 'PATCH /purchase/orders/:id'],
    ['approve', 'aprovar', 'POST /purchase/orders/:id/approve'],
    ['cancel', 'cancelar', 'POST /purchase/orders/:id/cancel'],
  ]),
  ...r('purchases', 'receiving', 'Recebimentos', [
    ['view', 'ver', 'GET /purchase/receipts'],
    ['create', 'registrar recebimento', 'POST /purchase/receipts'],
  ]),
  ...r('purchases', 'matching', 'Conciliação 3-way match', [
    ['view', 'ver', 'GET /purchase/orders/:id/match-status'],
    ['execute', 'executar match', 'POST /purchase/orders/:id/match'],
    ['resolve', 'resolver divergência', 'POST /purchase/matches/:id/resolve'],
  ]),
  ...r('purchases', 'requests', 'Solicitações de compra', [
    ['view', 'ver', 'GET /purchase/requests'],
    ['create', 'criar', 'POST /purchase/requests'],
    ['cancel', 'cancelar', 'POST /purchase/requests/:id/cancel'],
    ['convert', 'converter em pedido', 'POST /purchase/requests/:id/convert'],
  ]),
  ...r('purchases', 'rfq', 'Cotações (RFQ)', [
    ['view', 'ver', 'GET /rfq, GET /rfq/:id, GET /rfq/:id/compare'],
    ['create', 'criar', 'POST /rfq'],
    ['quote', 'registrar cotação de fornecedor', 'POST /rfq/:id/quotes'],
    ['award', 'adjudicar', 'POST /rfq/quotes/:quoteId/award'],
  ]),
  ...r('purchases', 'supplier-prices', 'Preços de fornecedores', [
    ['view', 'ver', 'GET /purchase/supplier-prices'],
  ]),
  ...r('purchases', 'inbound-nfe', 'NF-e de entrada', [
    ['view', 'ver', 'GET /inbound-nfe, /inbound-nfe/stats, /inbound-nfe/:id'],
    ['upload', 'fazer upload de XML', 'POST /inbound-nfe/upload'],
    ['match', 'vincular a pedido', 'PATCH /inbound-nfe/:id/match'],
    ['reject', 'rejeitar', 'PATCH /inbound-nfe/:id/reject'],
    ['import', 'importar (gera estoque + financeiro)', 'PATCH /inbound-nfe/:id/import'],
  ]),

  // ── stock ── (stock, transfer, batch, serial, warehouse, wms controllers)
  ...r('stock', 'balances', 'Saldos de estoque', [
    ['view', 'ver', 'GET /stock/balances, GET /stock/balances/:warehouseId/:productId'],
  ]),
  ...r('stock', 'movements', 'Movimentações de estoque', [
    ['view', 'ver', 'GET /stock/movements'],
    ['create', 'movimentar', 'POST /stock/move'],
    ['reverse', 'estornar', 'POST /stock/reverse/:movementId (destrutivo)'],
  ]),
  ...r('stock', 'transfers', 'Transferências entre filiais', [
    ['view', 'ver', 'GET /transfers, GET /transfers/:id'],
    ['create', 'criar', 'POST /transfers'],
    ['dispatch', 'despachar', 'PATCH /transfers/:id/dispatch'],
    ['receive', 'receber', 'PATCH /transfers/:id/receive'],
    ['cancel', 'cancelar', 'PATCH /transfers/:id/cancel'],
  ]),
  ...r('stock', 'batches', 'Lotes', [
    ['view', 'ver', 'GET /batch, /batch/stats, /batch/:id, /batch/:id/traceability'],
    ['create', 'criar', 'POST /batch'],
    ['consume', 'consumir', 'PATCH /batch/:id/consume'],
    ['quarantine', 'colocar em quarentena', 'PATCH /batch/:id/quarantine'],
    ['release', 'liberar da quarentena', 'PATCH /batch/:id/release'],
    ['scrap', 'sucatear', 'PATCH /batch/:id/scrap'],
    ['adjust', 'ajustar quantidade', 'PATCH /batch/:id/adjust'],
    ['check-expired', 'checar vencidos', 'POST /batch/check-expired'],
  ]),
  ...r('stock', 'serials', 'Números de série', [
    ['view', 'ver', 'GET /serial, /serial/stats, /serial/:id, /serial/:id/components, /serial/:id/tree, /serial/by-serial/:serial, /serial/batch/:batchId/affected'],
    ['create', 'criar', 'POST /serial'],
    ['update', 'editar', 'PATCH /serial/:id'],
    ['link', 'vincular a produção/venda', 'PATCH /serial/:id/link-production, /serial/:id/link-sale'],
    ['scrap', 'sucatear', 'PATCH /serial/:id/scrap'],
  ]),
  ...r('stock', 'warehouses', 'Depósitos', [
    ['view', 'ver', 'GET /warehouses, GET /warehouses/:id'],
    ['create', 'criar', 'POST /warehouses'],
    ['update', 'editar', 'PATCH /warehouses/:id'],
  ]),
  ...r('stock', 'wms', 'WMS', [
    ['view', 'ver', 'GET /wms/* (locations, receiving, picking, inventory, dashboard, relatórios)'],
    ['configure', 'configurar', 'POST /wms/locations, PATCH /wms/locations/:id/toggle, PATCH /wms/warehouses/:id/wms'],
    ['execute', 'executar tarefas (putaway/picking/contagem)', 'PATCH /wms/receiving/:id/tasks/:taskId/putaway, /wms/picking/:id/tasks/:taskId/confirm, /wms/inventory/:id/items/:itemId/count'],
  ]),
  ...r('stock', 'inventory', 'Inventário WMS', [
    ['create', 'abrir inventário', 'POST /wms/inventory'],
    ['reconcile', 'reconciliar (ajusta saldo)', 'POST /wms/inventory/:id/reconcile'],
    ['cancel', 'cancelar', 'POST /wms/inventory/:id/cancel'],
  ]),

  // ── production ── (production, bom, routing, mrp, capacity, scheduling controllers)
  ...r('production', 'orders', 'Ordens de produção', [
    ['view', 'ver', 'GET /production, /production/:id, /production/:id/logs, /production/:id/progress, /production/:id/cost, /production/metrics/scrap'],
    ['create', 'criar', 'POST /production'],
    ['release', 'liberar', 'PATCH /production/:id/release'],
    ['start', 'iniciar', 'PATCH /production/:id/start'],
    ['complete', 'concluir', 'PATCH /production/:id/complete'],
    ['cancel', 'cancelar', 'PATCH /production/:id/cancel'],
    ['execute', 'apontar produção', 'POST /production/:id/logs'],
    ['approve', 'aprovar inspeção', 'PATCH /production/:id/approve-inspection'],
    ['reject', 'reprovar inspeção', 'PATCH /production/:id/reject-inspection'],
  ]),
  ...r('production', 'bom', 'BOM (estrutura de produto)', [
    ['view', 'ver', 'GET /bom/:id, /bom/product/:productId, /bom/product/:productId/active'],
    ['create', 'criar', 'POST /bom'],
    ['activate', 'ativar versão (aprovação)', 'PATCH /bom/:id/activate'],
  ]),
  ...r('production', 'routing', 'Roteiros de produção', [
    ['view', 'ver', 'GET /routing/product/:productId'],
    ['create', 'criar', 'POST /routing'],
    ['update', 'editar', 'PATCH /routing/:id'],
    ['delete', 'excluir', 'DELETE /routing/:id'],
  ]),
  ...r('production', 'mrp', 'MRP', [
    ['view', 'ver', 'GET /mrp/runs, /mrp/runs/:id, /mrp/runs/:id/gaps'],
    ['run', 'rodar', 'POST /mrp/run'],
    ['convert', 'converter sugestões (gera PO/OP)', 'POST /mrp/suggestions/:id/convert, /mrp/suggestions/convert-batch'],
  ]),
  ...r('production', 'work-centers', 'Centros de trabalho', [
    ['view', 'ver', 'GET /capacity/work-centers, /capacity/work-centers/stats, /capacity/work-centers/:id, /capacity/plan, /capacity/load-by-product'],
    ['create', 'criar', 'POST /capacity/work-centers'],
    ['update', 'editar', 'PATCH /capacity/work-centers/:id'],
    ['delete', 'excluir', 'DELETE /capacity/work-centers/:id'],
  ]),
  ...r('production', 'scheduling', 'Sequenciamento', [
    ['view', 'ver', 'GET /production/schedule, /production/schedule/gantt'],
    ['generate', 'gerar', 'POST /production/schedule/generate/:workCenterId'],
  ]),

  // ── quality ── (quality.controller.ts)
  ...r('quality', 'inspections', 'Inspeções', [
    ['view', 'ver', 'GET /quality/inspections, GET /quality/inspections/:id'],
    ['create', 'criar', 'POST /quality/inspections'],
    ['start', 'iniciar', 'PATCH /quality/inspections/:id/start'],
    ['approve', 'aprovar', 'PATCH /quality/inspections/:id/pass'],
    ['reject', 'reprovar', 'PATCH /quality/inspections/:id/fail'],
    ['hold', 'reter', 'PATCH /quality/inspections/:id/hold'],
  ]),
  ...r('quality', 'ncr', 'Não conformidades (NCR)', [
    ['view', 'ver', 'GET /quality/ncr, GET /quality/ncr/:id'],
    ['create', 'criar', 'POST /quality/ncr'],
    ['update', 'editar', 'PATCH /quality/ncr/:id'],
    ['analyze', 'analisar causa', 'PATCH /quality/ncr/:id/analyze'],
    ['corrective-action', 'registrar ação corretiva', 'PATCH /quality/ncr/:id/corrective-action'],
    ['close', 'fechar', 'PATCH /quality/ncr/:id/close'],
    ['cancel', 'cancelar', 'PATCH /quality/ncr/:id/cancel'],
  ]),
  ...r('quality', 'reports', 'Indicadores de qualidade', [
    ['view', 'ver', 'GET /quality/stats'],
  ]),

  // ── maintenance ── (maintenance.controller.ts)
  ...r('maintenance', 'equipment', 'Equipamentos', [
    ['view', 'ver', 'GET /maintenance/equipment, /maintenance/equipment/stats, /maintenance/equipment/:id'],
    ['create', 'criar', 'POST /maintenance/equipment'],
    ['update', 'editar', 'PATCH /maintenance/equipment/:id'],
    ['deactivate', 'desativar', 'PATCH /maintenance/equipment/:id/deactivate'],
  ]),
  ...r('maintenance', 'orders', 'Ordens de manutenção', [
    ['view', 'ver', 'GET /maintenance/orders, GET /maintenance/orders/:id'],
    ['create', 'criar', 'POST /maintenance/orders'],
    ['start', 'iniciar', 'PATCH /maintenance/orders/:id/start'],
    ['complete', 'concluir', 'PATCH /maintenance/orders/:id/complete'],
    ['cancel', 'cancelar', 'PATCH /maintenance/orders/:id/cancel'],
  ]),

  // ── finance ── (finance, banking, billing, budget controllers) — leitura restrita 🔒
  ...r('finance', 'entries', 'Lançamentos (pagar/receber)', [
    ['view', 'ver', 'GET /finance, GET /finance/:id, GET /finance/cashflow'],
    ['create', 'criar lançamento manual', 'POST /finance/entries/manual'],
    ['pay', 'baixar/pagar', 'PATCH /finance/:id/pay'],
    ['installment', 'parcelar', 'POST /finance/:id/installments'],
    ['cancel', 'cancelar', 'PATCH /finance/:id/cancel'],
    // #623 (E1): baixa como perda some do contas a receber — restrita à gerência
    ['write-off', 'baixar como perda (write-off)', 'POST /finance/entries/:id/write-off'],
  ]),
  // #623 (E1): regras de PDD mudam o resultado contábil — configurar é gerência
  ...r('finance', 'provisions', 'Provisões (PDD)', [
    ['view', 'ver regras e relatório', 'GET /finance/provision-rules, GET /finance/pdd'],
    ['configure', 'configurar regras', 'POST /finance/provision-rules/seed-defaults, PATCH /finance/provision-rules/:id'],
  ]),
  // #623 (E1): adiantamento a fornecedor = dinheiro saindo antes da entrega
  ...r('finance', 'advances', 'Adiantamentos a fornecedor', [
    ['view', 'ver', 'GET /finance/supplier-advances'],
    ['create', 'criar', 'POST /finance/supplier-advances'],
    ['cancel', 'cancelar', 'POST /finance/supplier-advances/:id/cancel'],
  ]),
  // #623 (E1): dívidas/empréstimos e pagamento de parcelas
  ...r('finance', 'debts', 'Dívidas e empréstimos', [
    ['view', 'ver', 'GET /finance/debts, /finance/debts/dashboard, /finance/debts/:id'],
    ['create', 'criar', 'POST /finance/debts'],
    ['pay', 'pagar parcela', 'POST /finance/debts/:id/installments/:number/pay'],
  ]),
  // #623 (E1): quem concilia "fecha o caixa" — import OFX, match/unmatch
  ...r('finance', 'reconciliation', 'Conciliação bancária', [
    ['execute', 'conciliar extrato', 'POST /banking/reconciliation/{import,auto-match,:statementId/match,:statementId/unmatch}'],
  ]),
  // #623 (E1): taxas de cartão negociadas — leitura era ABERTA a qualquer autenticado
  ...r('finance', 'acquirers', 'Adquirentes (taxas de cartão)', [
    ['view', 'ver', 'GET /acquirers, /acquirers/:id, /acquirers/:id/fees/resolve'],
    ['manage', 'gerir adquirentes e taxas', 'POST /acquirers, PATCH /acquirers/:id, POST /acquirers/:id/fees, PATCH /acquirers/fees/:feeId'],
  ]),
  // #623 (E1): projetos de investimento — approve é alçada (DIRETOR+admins)
  ...r('finance', 'investments', 'Análise de investimentos', [
    ['view', 'ver', 'GET /investments, /investments/compare, /investments/:id'],
    ['manage', 'criar/editar projetos e fluxos', 'POST /investments, PATCH/DELETE /investments/:id, POST/DELETE /investments/:id/cashflows'],
    ['approve', 'aprovar/rejeitar (alçada)', 'POST /investments/:id/approve, POST /investments/:id/reject'],
  ]),
  // #623 (E1): budget dirigido por drivers (Volume × Preço × Mix)
  ...r('finance', 'budget-plans', 'Budget por drivers', [
    ['view', 'ver', 'GET /budget-plans, /budget-plans/:id/{projection,sensitivity,vs-realized}'],
    ['manage', 'criar/editar planos e drivers', 'POST/PATCH/DELETE /budget-plans*, POST/DELETE /budget-plans/:id/drivers*'],
  ]),
  ...r('finance', 'bank-accounts', 'Contas bancárias', [
    ['view', 'ver', 'GET /finance/bank-accounts, /finance/bank-accounts/consolidated, /finance/bank-accounts/:id/statement'],
    ['create', 'criar', 'POST /finance/bank-accounts'],
    ['update', 'editar', 'PATCH /finance/bank-accounts/:id'],
    ['delete', 'excluir', 'DELETE /finance/bank-accounts/:id'],
  ]),
  ...r('finance', 'categories', 'Categorias financeiras', [
    ['view', 'ver', 'GET /finance/categories'],
    ['create', 'criar', 'POST /finance/categories'],
    ['update', 'editar', 'PATCH /finance/categories/:id'],
    ['delete', 'excluir', 'DELETE /finance/categories/:id'],
  ]),
  ...r('finance', 'cost-centers', 'Centros de custo', [
    ['view', 'ver', 'GET /finance/cost-centers'],
    ['create', 'criar', 'POST /finance/cost-centers'],
    ['update', 'editar', 'PATCH /finance/cost-centers/:id'],
    ['delete', 'excluir', 'DELETE /finance/cost-centers/:id'],
  ]),
  ...r('finance', 'reports', 'Relatórios financeiros', [
    ['view', 'ver DRE e projeção de caixa', 'GET /finance/reports/dre, /finance/cash-flow/projection, /finance/kpis, /finance/margin-by-sku, /banking/cash-flow/{weekly,monthly,scenarios}, /forecast/financial'],
    // #623 (E1): management book = pacote executivo consolidado
    ['export', 'exportar management book', 'GET /finance/management-book'],
  ]),
  ...r('finance', 'banking', 'Banking', [
    ['view', 'ver', 'GET /banking/accounts, /banking/overview, /banking/reconciliation/unmatched, /banking/accounts/:id, /banking/accounts/:id/balance'],
    ['configure', 'configurar conta', 'PATCH /banking/accounts/:id/configure'],
  ]),
  ...r('finance', 'payment-schedules', 'Agendamentos de pagamento', [
    ['view', 'ver', 'GET /banking/schedules'],
    ['create', 'agendar', 'POST /banking/schedule'],
    ['delete', 'excluir', 'DELETE /banking/schedule/:id'],
  ]),
  ...r('finance', 'boletos', 'Boletos', [
    ['view', 'ver', 'GET /banking/boletos'],
    ['create', 'emitir', 'POST /banking/boletos'],
    ['delete', 'excluir', 'DELETE /banking/boletos/:id'],
  ]),
  ...r('finance', 'pix', 'Cobranças PIX', [
    ['view', 'ver', 'GET /banking/pix/charges'],
    ['create', 'criar', 'POST /banking/pix/charges'],
    ['cancel', 'cancelar', 'PATCH /banking/pix/charges/:id/cancel'],
  ]),
  ...r('finance', 'billing', 'Régua de cobrança', [
    ['view', 'ver', 'GET /billing/collection/status, /billing/daily-report, /billing/collection-rules'],
    ['execute', 'disparar cobrança', 'POST /billing/collection/trigger, POST /billing/collection-rules/run'],
    // #623 (E1): mudar a régua muda QUANDO/COMO o cliente é cobrado — gerência
    ['configure', 'configurar régua', 'POST /billing/collection-rules/seed-defaults, PATCH /billing/collection-rules/:id'],
  ]),
  ...r('finance', 'budget', 'Orçamento empresarial', [
    ['view', 'ver', 'GET /finance/budget, GET /finance/budget/variance'],
    ['create', 'criar linha', 'POST /finance/budget'],
    ['delete', 'excluir linha', 'DELETE /finance/budget/:id'],
  ]),

  // ── fiscal ── (fiscal, manifest, tax controllers)
  ...r('fiscal', 'documents', 'Documentos fiscais', [
    ['view', 'ver', 'GET /fiscal, GET /fiscal/:id'],
    // #623 (E1): ZIP com a massa fiscal completa (XMLs, #482) — restrito
    ['export', 'exportar XMLs (ZIP)', 'GET /fiscal/export'],
  ]),
  ...r('fiscal', 'nfe', 'NF-e (eventos)', [
    ['cancel', 'cancelar NF-e', 'POST /fiscal/:id/cancel (prazo legal 24h)'],
    ['correct', 'emitir carta de correção (CC-e)', 'POST /fiscal/:id/correction'],
    ['void-range', 'inutilizar faixa de numeração', 'POST /fiscal/void-range'],
    ['retry', 'reprocessar rejeitada', 'POST /fiscal/:id/retry'],
  ]),
  ...r('fiscal', 'manifestation', 'Manifestação do destinatário', [
    ['view', 'ver', 'GET /fiscal/manifest, /fiscal/manifest/pending, /fiscal/manifest/stats, /fiscal/manifest/overdue'],
    ['sync', 'sincronizar com a SEFAZ', 'POST /fiscal/manifest/sync'],
    ['execute', 'manifestar (ciência/confirmar/rejeitar/desconhecer)', 'POST /fiscal/manifest/:chaveNfe/{ciencia,confirm,reject,unknown}'],
  ]),
  ...r('fiscal', 'tax-rules', 'Regras tributárias', [
    ['view', 'ver', 'GET /tax-rules, GET /tax-rules/:id (leitura restrita 🔒)'],
    ['create', 'criar', 'POST /tax-rules'],
    ['update', 'editar', 'PATCH /tax-rules/:id'],
    ['delete', 'excluir', 'DELETE /tax-rules/:id'],
  ]),
  ...r('fiscal', 'tributary-classifications', 'Classificações tributárias (cClassTrib)', [
    ['view', 'ver', 'GET /tributary-classifications, GET /tributary-classifications/:code'],
    ['sync', 'sincronizar tabela de referência', 'POST /tributary-classifications/sync'],
  ]),

  // ── settings ── (user.controller.ts + company.controller.ts)
  ...r('settings', 'users', 'Usuários', [
    ['view', 'ver', 'GET /users, GET /users/:id (leitura restrita 🔒)'],
    ['create', 'criar', 'POST /users'],
    ['update', 'editar', 'PATCH /users/:id'],
  ]),
  ...r('settings', 'companies', 'Empresas', [
    ['view', 'ver', 'GET /companies, GET /companies/:id'],
    ['create', 'criar', 'POST /companies (ação global do sistema)'],
    ['update', 'editar', 'PATCH /companies/:id'],
  ]),

  // ── approvals ── (approval.controller.ts)
  ...r('approvals', 'requests', 'Aprovações por alçada', [
    ['view', 'ver fila pendente', 'GET /approvals/pending (leitura restrita 🔒)'],
    ['approve', 'aprovar/rejeitar documento', 'POST /approvals/:documentId/approve'],
  ]),

  // ── lgpd ── (lgpd.controller.ts) — dados pessoais de titulares 🔒
  ...r('lgpd', 'consents', 'Consentimentos LGPD', [
    ['view', 'ver', 'GET /lgpd/consent'],
    ['create', 'registrar', 'POST /lgpd/consent'],
    ['revoke', 'revogar', 'POST /lgpd/consent/:id/revoke'],
  ]),
  ...r('lgpd', 'data-subjects', 'Dados de titulares', [
    ['view', 'consultar por documento', 'GET /lgpd/data-subject/:document'],
  ]),
  ...r('lgpd', 'anonymization', 'Anonimização', [
    ['view', 'ver solicitações', 'GET /lgpd/anonymization-requests'],
    ['request', 'solicitar', 'POST /lgpd/anonymize/:document'],
    ['process', 'processar (irreversível)', 'POST /lgpd/anonymize/:requestId/process'],
  ]),

  // ── iam ── (iam/audit.controller.ts) — trilha de auditoria 🔒
  ...r('iam', 'audit-logs', 'Audit logs', [
    ['view', 'ver', 'GET /iam/audit-logs (leitura restrita 🔒 — trilha de auditoria v2)'],
  ]),
  // ── iam ── (iam/roles-admin.controller.ts + iam/user-access.controller.ts, #352) 🔒
  ...r('iam', 'roles', 'Perfis e permissões', [
    ['view', 'ver', 'GET /iam/roles, /iam/roles/:id/permissions, /iam/permissions, /iam/users/:userId/{roles,permissions} (leitura restrita 🔒)'],
    ['manage', 'criar/editar/excluir perfis', 'POST/PATCH/DELETE /iam/roles, PUT /iam/roles/:id/permissions'],
    ['assign', 'atribuir perfis e exceções a usuários', 'POST/DELETE /iam/users/:userId/roles, POST/DELETE /iam/users/:userId/permissions'],
  ]),

  // ── iam ── (iam/org-structure.controller.ts, #347 F5.2 fase 1) 🔒
  ...r('iam', 'org', 'Estrutura organizacional', [
    ['view', 'ver', 'GET /iam/{branches,departments,teams}, /iam/users/:userId/{departments,teams} (leitura restrita 🔒)'],
    ['manage', 'criar/editar/excluir filiais, departamentos e equipes', 'POST/PATCH/DELETE /iam/branches, /iam/departments, /iam/teams'],
    ['assign', 'vincular usuários a departamentos e equipes', 'POST/DELETE /iam/users/:userId/departments, /iam/users/:userId/teams'],
  ]),

  // ── vehicle-tracking ── (vehicle-tracking.controller.ts)
  ...r('vehicle-tracking', 'bin', 'BIN veicular', [
    ['view', 'ver', 'GET /vehicle-tracking/bin, /bin/pending, /bin/serial/:serialNumberId'],
    ['create', 'registrar', 'POST /vehicle-tracking/bin'],
    ['update', 'editar', 'PATCH /vehicle-tracking/bin/:id'],
  ]),
  ...r('vehicle-tracking', 'atpve', 'ATPV-e', [
    ['view', 'ver', 'GET /vehicle-tracking/atpve, /atpve/pending, /atpve/:id, /atpve/:id/pdf'],
    ['create', 'registrar', 'POST /vehicle-tracking/atpve'],
    ['update', 'editar', 'PATCH /vehicle-tracking/atpve/:id, POST /atpve/:id/resend-email'],
  ]),
  // #529-#533: integração automática BIN/RENAVE via SERPRO (épico #527)
  ...r('vehicle-tracking', 'renave', 'Integração RENAVE', [
    ['view', 'ver status', 'GET /vehicle-tracking/renave/sales-order/:salesOrderId'],
    ['retry', 're-executar operação em erro', 'POST /vehicle-tracking/renave/operations/:id/retry'],
    ['manage', 'devolver à montadora (cenário B)', 'POST /vehicle-tracking/renave/devolver-montadora'],
  ]),
  // #625 (bloco G): documentos regulatórios do veículo (#364 — CAT/CCT/projeto
  // técnico) — sensíveis: view restrita a quem tem necessidade real (decisão
  // Rafael; SOMENTE_LEITURA fora); manage SEM Financeiro (o legado dava).
  ...r('vehicle-tracking', 'documents', 'Documentos do veículo (CAT/CCT)', [
    ['view', 'ver', 'GET /vehicle-documents, /pending-deliveries, /by-sale/:salesOrderId, /:id'],
    ['manage', 'criar/editar/excluir/registrar entrega', 'POST/PATCH/DELETE /vehicle-documents*, POST /vehicle-documents/:id/deliveries'],
  ]),
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Todos os codes do catálogo, em ordem */
export function allPermissionCodes(): string[] {
  return PERMISSIONS_CATALOG.map((p) => p.code);
}

/** Codes de um ou mais módulos inteiros */
export function moduleCodes(...modules: string[]): string[] {
  return PERMISSIONS_CATALOG.filter((p) => modules.includes(p.module)).map((p) => p.code);
}

/** Codes de um recurso específico */
export function resourceCodes(module: string, resource: string): string[] {
  return PERMISSIONS_CATALOG
    .filter((p) => p.module === module && p.resource === resource)
    .map((p) => p.code);
}

/** Todos os codes com uma ação específica (default: 'view'), opcionalmente filtrados por módulos */
export function actionCodes(action = 'view', modules?: string[]): string[] {
  return PERMISSIONS_CATALOG
    .filter((p) => p.action === action && (!modules || modules.includes(p.module)))
    .map((p) => p.code);
}

/** Lista de módulos distintos do catálogo */
export function catalogModules(): string[] {
  return [...new Set(PERMISSIONS_CATALOG.map((p) => p.module))];
}
