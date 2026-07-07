/**
 * Catálogo dos perfis (roles) system do IAM v2 — issue #339 (Fase F2/M1).
 *
 * 28 perfis padrão (`isSystem = true`): os 24 da issue #339 + ajustes de
 * negócio do Rafael (#463): (a) o perfil "Loja" foi dividido em três em cadeia
 * de herança — LOJA_OPERACIONAL → LOJA_FATURAMENTO → GERENTE_LOJA (venda,
 * faturamento controlado e gerência de filial); (b) GERENTE_GERAL, perfil
 * gerencial amplo que recebe o enum `MANAGER` (antes ia p/ GERENTE_INDUSTRIAL).
 *
 * Coerência: as permissões seguem a matriz RBAC draft da Parte 4.3 da
 * arquitetura e a filosofia do docs/RBAC.md (PR #453): NA DÚVIDA, RESTRINGIR.
 * É mais fácil abrir permissão depois do que fechar um buraco em produção.
 *
 * Herança (`parentCode`): o perfil filho carrega no banco APENAS o delta —
 * o PermissionService (#340) resolve a cadeia parent → child em runtime.
 *
 * ENUM_ROLE_TO_SYSTEM_ROLE: mapeamento 1:1 dos 10 valores do enum `UserRole`
 * atual para o perfil system equivalente (Parte 4.2 da arquitetura), usado
 * pelo espelhamento automático do seed (Fase M1). O enum NÃO é tocado — segue
 * como fallback durante toda a migração.
 */

import {
  allPermissionCodes,
  moduleCodes,
  resourceCodes,
  actionCodes,
} from './permissions.catalog';

export interface SystemRoleDef {
  /** Código único do perfil (ex.: 'GERENTE_INDUSTRIAL') */
  code: string;
  /** Nome legível em pt-BR */
  name: string;
  description: string;
  /** Código do perfil pai (herança) — o filho só carrega o delta */
  parentCode?: string;
  /** Codes de permissão concedidos diretamente a este perfil */
  permissions: string[];
}

/** Deduplica preservando ordem */
function dedupe(codes: string[]): string[] {
  return [...new Set(codes)];
}

/** Dashboards operacionais (todos exceto o financeiro, que é leitura restrita 🔒) */
const DASHBOARDS_OPERACIONAIS = [
  'dashboard.executive.view',
  'dashboard.sales.view',
  'dashboard.production.view',
  'dashboard.stock.view',
  'dashboard.purchases.view',
];

/**
 * Leituras liberadas ao perfil "Somente Leitura" (READER): tudo que é `view`,
 * EXCETO os módulos/recursos sensíveis restritos pelo docs/RBAC.md —
 * financeiro, comissões, usuários, LGPD, fila de aprovações e dashboard
 * financeiro.
 */
const VIEWS_NAO_SENSIVEIS = actionCodes('view').filter(
  (code) =>
    !code.startsWith('finance.') &&
    !code.startsWith('lgpd.') &&
    code !== 'sales.commissions.view' &&
    code !== 'settings.users.view' &&
    code !== 'approvals.requests.view' &&
    code !== 'dashboard.finance.view' &&
    code !== 'suppliers.portal-tokens.view' &&
    // Trilha de auditoria (iam.*) é sensível: fora do perfil somente-leitura
    !code.startsWith('iam.'),
);

export const SYSTEM_ROLES: SystemRoleDef[] = [
  // ── Nível Sistema ──────────────────────────────────────────────────────────
  {
    code: 'ADMIN_GLOBAL',
    name: 'Administrador Global',
    description:
      'Administrador do sistema — todas as permissões, inclusive ações globais (criar empresas, sincronizar tabelas de referência). Equivale ao enum SUPER_ADMIN.',
    permissions: allPermissionCodes(),
  },

  // ── Nível Empresa ──────────────────────────────────────────────────────────
  {
    code: 'ADMIN_EMPRESA',
    name: 'Administrador da Empresa',
    description:
      'Tudo dentro da empresa, exceto ações globais do sistema (criar empresas, sincronizar tabela cClassTrib).',
    permissions: allPermissionCodes().filter(
      (code) =>
        code !== 'settings.companies.create' &&
        code !== 'fiscal.tributary-classifications.sync',
    ),
  },
  {
    code: 'ADMIN_FILIAL',
    name: 'Administrador da Filial',
    description:
      'Operação completa no escopo da filial (vendas, compras, estoque, produção); leitura em produtos, qualidade, financeiro e configurações. O recorte por filial é aplicado via branchId no UserRoleAssignment (Decisão 3).',
    permissions: dedupe([
      ...DASHBOARDS_OPERACIONAIS,
      'dashboard.finance.view',
      ...resourceCodes('dashboard', 'alerts'),
      ...moduleCodes('sales', 'purchases', 'stock', 'production'),
      'products.catalog.view',
      'products.pricing.view',
      ...moduleCodes('customers'),
      'suppliers.registry.view',
      ...actionCodes('view', ['quality', 'maintenance']),
      'finance.entries.view',
      'finance.reports.view',
      'settings.users.view',
      'settings.companies.view',
      ...moduleCodes('analytics'),
    ]),
  },

  // ── Nível Diretoria ────────────────────────────────────────────────────────
  {
    code: 'DIRETOR',
    name: 'Diretor',
    description:
      'Enxerga tudo (leitura geral), aprova (compras, alçadas, BOM, comissões, orçamentos) e exporta. Não opera o dia-a-dia. Equivale ao enum DIRECTOR. NÃO vê a trilha de auditoria (iam.audit-logs): logs podem conter dados sensíveis de segurança/operação — restritos a ADMIN_GLOBAL, ADMIN_EMPRESA e AUDITOR (decisão Rafael, #341).',
    permissions: dedupe([
      // Trilha de auditoria (iam.*) fica FORA da diretoria — ver descrição.
      ...actionCodes('view').filter((code) => !code.startsWith('iam.')),
      'products.catalog.update',
      'production.bom.activate',
      'purchases.orders.approve',
      'purchases.orders.cancel',
      'purchases.rfq.award',
      'purchases.requests.convert',
      'sales.quotations.approve',
      'sales.commissions.approve',
      'sales.commissions.configure',
      'approvals.requests.approve',
      'fiscal.tax-rules.create',
      'fiscal.tax-rules.update',
      'fiscal.tax-rules.delete',
      'lgpd.consents.create',
      'lgpd.consents.revoke',
      'lgpd.anonymization.request',
      'lgpd.anonymization.process',
      'analytics.reports.create',
      'analytics.export.execute',
      'suppliers.portal-tokens.view',
    ]),
  },

  // ── Nível Gerência ─────────────────────────────────────────────────────────
  {
    code: 'GERENTE_INDUSTRIAL',
    name: 'Gerente Industrial',
    description:
      'Produção, Estoque, Qualidade e Manutenção completos (CRUD + aprovações); leitura em produtos, vendas e compras.',
    permissions: dedupe([
      ...DASHBOARDS_OPERACIONAIS,
      ...resourceCodes('dashboard', 'alerts'),
      ...moduleCodes('production', 'stock', 'quality', 'maintenance'),
      'products.catalog.view',
      'products.pricing.view',
      ...actionCodes('view', ['sales', 'purchases']),
      'suppliers.registry.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      'analytics.reports.create',
    ]),
  },
  {
    code: 'GERENTE_GERAL',
    name: 'Gerente Geral',
    description:
      'Gerência ampla e transversal (recebe o enum MANAGER): opera e enxerga vendas, compras, estoque e produção (CRUD + aprovações operacionais), dashboards e leitura de financeiro/fiscal. Fatura venda (o MANAGER já faturava). PROTEGIDO por padrão (fora deste perfil): administração de permissões/usuários, configuração bancária/cobrança, ações fiscais críticas (cancelamento NF-e, CC-e, inutilização, regras tributárias), devolução/cancelamento sensível de venda e mudanças estruturais de segurança.',
    permissions: dedupe([
      ...DASHBOARDS_OPERACIONAIS,
      'dashboard.finance.view',
      ...resourceCodes('dashboard', 'alerts'),
      // Vendas: operação + faturar; SEM devolução/cancelamento sensível
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.reserve',
      'sales.orders.confirm',
      'sales.orders.invoice',
      ...resourceCodes('sales', 'quotations'),
      ...resourceCodes('sales', 'demand'),
      ...resourceCodes('sales', 'forecast'),
      'sales.commissions.view',
      ...moduleCodes('customers'),
      // Compras e fornecedores: operação + aprovações
      ...moduleCodes('purchases', 'suppliers'),
      // Estoque e produção: operação completa
      ...moduleCodes('stock', 'production'),
      // Produtos
      'products.catalog.view',
      'products.catalog.create',
      'products.catalog.update',
      'products.pricing.view',
      'products.pricing.create',
      // Financeiro e fiscal: SOMENTE leitura (sem operar/configurar)
      'finance.entries.view',
      'finance.reports.view',
      'fiscal.documents.view',
      // Aprovações operacionais
      'approvals.requests.view',
      'approvals.requests.approve',
      // Analytics
      ...moduleCodes('analytics'),
    ]),
  },
  {
    code: 'GERENTE_FINANCEIRO',
    name: 'Gerente Financeiro',
    description:
      'Financeiro e Fiscal completos (CRUD + aprovações + configuração); leitura em produtos, vendas e compras. Aprova comissões.',
    permissions: dedupe([
      ...DASHBOARDS_OPERACIONAIS,
      'dashboard.finance.view',
      ...moduleCodes('finance', 'fiscal'),
      'products.catalog.view',
      'products.pricing.view',
      ...actionCodes('view', ['sales', 'purchases']),
      'sales.orders.invoice',
      'sales.commissions.approve',
      'purchases.matching.view',
      'purchases.matching.execute',
      'purchases.matching.resolve',
      ...resourceCodes('purchases', 'inbound-nfe'),
      'customers.registry.view',
      'suppliers.registry.view',
      'approvals.requests.view',
      'approvals.requests.approve',
      ...moduleCodes('analytics', 'vehicle-tracking'),
    ]),
  },
  {
    code: 'GERENTE_COMERCIAL',
    name: 'Gerente Comercial',
    description:
      'Vendas, orçamentos, clientes, demanda e forecast completos (CRUD + aprovações); leitura de contas a receber e estoque.',
    permissions: dedupe([
      ...DASHBOARDS_OPERACIONAIS,
      ...resourceCodes('dashboard', 'alerts'),
      ...moduleCodes('sales', 'customers'),
      'products.catalog.view',
      'products.catalog.update',
      'products.pricing.view',
      'products.pricing.create',
      'stock.balances.view',
      'finance.entries.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      'analytics.reports.create',
      'analytics.export.execute',
    ]),
  },
  {
    code: 'GERENTE_COMPRAS',
    name: 'Gerente de Compras',
    description:
      'Compras, RFQ, recebimento e fornecedores completos (CRUD + aprovações); leitura de contas a pagar e estoque.',
    permissions: dedupe([
      ...DASHBOARDS_OPERACIONAIS,
      ...resourceCodes('dashboard', 'alerts'),
      ...moduleCodes('purchases', 'suppliers'),
      'products.catalog.view',
      'products.pricing.view',
      'stock.balances.view',
      'stock.movements.view',
      'finance.entries.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
      'analytics.reports.create',
    ]),
  },

  // ── Nível Supervisão (herança) ─────────────────────────────────────────────
  {
    code: 'SUPERVISOR_PRODUCAO',
    name: 'Supervisor de Produção',
    description:
      'Herda Operador de Produção e acrescenta liberar/concluir/cancelar ordens e aprovar/reprovar inspeções.',
    parentCode: 'OPERADOR_PRODUCAO',
    permissions: [
      'production.orders.create',
      'production.orders.release',
      'production.orders.complete',
      'production.orders.cancel',
      'production.orders.approve',
      'production.orders.reject',
      'production.scheduling.generate',
    ],
  },
  {
    code: 'SUPERVISOR_ESTOQUE',
    name: 'Supervisor de Estoque',
    description:
      'Herda Almoxarife e acrescenta as ações destrutivas/de aprovação: estorno de movimentação, cancelamento de transferências, reconciliação e cancelamento de inventário, configuração do WMS.',
    parentCode: 'ALMOXARIFE',
    permissions: [
      'stock.movements.reverse',
      'stock.transfers.cancel',
      'stock.inventory.reconcile',
      'stock.inventory.cancel',
      'stock.wms.configure',
      'stock.batches.adjust',
    ],
  },
  {
    code: 'COORDENADOR_COMERCIAL',
    name: 'Coordenador Comercial',
    description:
      'Herda Vendedor e acrescenta aprovar/rejeitar/expirar orçamentos e cancelar pedidos de venda.',
    parentCode: 'VENDEDOR',
    permissions: [
      'sales.quotations.approve',
      'sales.quotations.reject',
      'sales.quotations.expire',
      'sales.quotations.delete',
      'sales.orders.cancel',
    ],
  },

  // ── Nível Operacional ──────────────────────────────────────────────────────
  {
    code: 'COMPRADOR',
    name: 'Comprador',
    description:
      'Cria e edita pedidos de compra, solicitações e RFQs; NÃO aprova pedido (segregação de funções). Leitura de fornecedores, produtos e estoque.',
    permissions: dedupe([
      'dashboard.purchases.view',
      'dashboard.stock.view',
      'purchases.orders.view',
      'purchases.orders.create',
      'purchases.orders.update',
      'purchases.receiving.view',
      'purchases.requests.view',
      'purchases.requests.create',
      'purchases.requests.cancel',
      ...resourceCodes('purchases', 'rfq').filter((c) => c !== 'purchases.rfq.award'),
      'purchases.supplier-prices.view',
      'purchases.inbound-nfe.view',
      'suppliers.registry.view',
      'products.catalog.view',
      'products.pricing.view',
      'stock.balances.view',
    ]),
  },
  {
    code: 'VENDEDOR',
    name: 'Vendedor',
    description:
      'Cria e conduz orçamentos e pedidos de venda (criar/reservar/confirmar/enviar/converter); mantém clientes; vê as próprias comissões. NÃO fatura (fiscal/financeiro) nem aprova orçamento (Coordenador). Equivale ao enum COMMERCIAL.',
    permissions: dedupe([
      'dashboard.sales.view',
      'dashboard.executive.view',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.reserve',
      'sales.orders.confirm',
      'sales.quotations.view',
      'sales.quotations.create',
      'sales.quotations.update',
      'sales.quotations.send',
      'sales.quotations.convert',
      ...resourceCodes('sales', 'demand'),
      ...resourceCodes('sales', 'forecast'),
      'sales.commissions.view',
      ...moduleCodes('customers'),
      'products.catalog.view',
      'products.catalog.create',
      'products.pricing.view',
      'products.pricing.create',
      'stock.balances.view',
    ]),
  },
  {
    code: 'OPERADOR_PCP',
    name: 'Operador PCP',
    description:
      'Planejamento e controle da produção: cria ordens, roda MRP e converte sugestões, gera sequenciamento; leitura de BOM, roteiros, capacidade, estoque e compras. Recebe os usuários do enum PRODUCTION na migração.',
    permissions: dedupe([
      'dashboard.production.view',
      'dashboard.stock.view',
      'production.orders.view',
      'production.orders.create',
      ...resourceCodes('production', 'mrp'),
      'production.bom.view',
      'production.routing.view',
      ...resourceCodes('production', 'scheduling'),
      'production.work-centers.view',
      'products.catalog.view',
      'stock.balances.view',
      'stock.movements.view',
      ...actionCodes('view', ['purchases']),
      'sales.demand.view',
      'sales.forecast.view',
    ]),
  },
  {
    code: 'OPERADOR_PRODUCAO',
    name: 'Operador de Produção',
    description:
      'Chão de fábrica: vê ordens, inicia e aponta produção; leitura de estoque, BOM e roteiros.',
    permissions: dedupe([
      'dashboard.production.view',
      'production.orders.view',
      'production.orders.start',
      'production.orders.execute',
      'production.bom.view',
      'production.routing.view',
      'production.scheduling.view',
      'production.work-centers.view',
      'products.catalog.view',
      'stock.balances.view',
    ]),
  },
  {
    code: 'ALMOXARIFE',
    name: 'Almoxarife',
    description:
      'Estoque operacional completo: movimentações, transferências, lotes, séries, WMS (execução), recebimento de compras, NF-e de entrada e solicitações de compra. Equivale ao enum WAREHOUSE.',
    permissions: dedupe([
      'dashboard.stock.view',
      'dashboard.purchases.view',
      'stock.balances.view',
      'stock.movements.view',
      'stock.movements.create',
      ...resourceCodes('stock', 'transfers').filter((c) => c !== 'stock.transfers.cancel'),
      ...resourceCodes('stock', 'batches').filter(
        (c) => !['stock.batches.quarantine', 'stock.batches.release', 'stock.batches.scrap'].includes(c),
      ),
      ...resourceCodes('stock', 'serials').filter((c) => c !== 'stock.serials.scrap'),
      'stock.warehouses.view',
      'stock.wms.view',
      'stock.wms.execute',
      'stock.inventory.create',
      'purchases.receiving.view',
      'purchases.receiving.create',
      'purchases.requests.view',
      'purchases.requests.create',
      'purchases.requests.cancel',
      'purchases.orders.view',
      'purchases.rfq.view',
      'purchases.rfq.create',
      'purchases.rfq.quote',
      'purchases.inbound-nfe.view',
      'purchases.inbound-nfe.upload',
      'purchases.inbound-nfe.match',
      'products.catalog.view',
      'suppliers.registry.view',
    ]),
  },
  {
    code: 'FINANCEIRO',
    name: 'Financeiro',
    description:
      'Contas a pagar/receber (CRUD + baixa/pagamento), cobrança, boletos, PIX, agendamentos, faturamento de vendas e conciliação 3-way; contas bancárias somente leitura (gestão é do Gerente Financeiro). Equivale ao enum FINANCIAL.',
    permissions: dedupe([
      'dashboard.finance.view',
      'dashboard.executive.view',
      ...resourceCodes('finance', 'entries'),
      'finance.bank-accounts.view',
      ...resourceCodes('finance', 'categories').filter((c) => c !== 'finance.categories.delete'),
      ...resourceCodes('finance', 'cost-centers').filter((c) => c !== 'finance.cost-centers.delete'),
      'finance.reports.view',
      'finance.banking.view',
      ...resourceCodes('finance', 'payment-schedules'),
      ...resourceCodes('finance', 'boletos'),
      ...resourceCodes('finance', 'pix'),
      ...resourceCodes('finance', 'billing'),
      'finance.budget.view',
      'fiscal.documents.view',
      'fiscal.manifestation.view',
      'sales.orders.view',
      'sales.orders.invoice',
      'sales.commissions.view',
      'sales.commissions.approve',
      'purchases.orders.view',
      'purchases.matching.view',
      'purchases.matching.execute',
      'purchases.inbound-nfe.view',
      'purchases.inbound-nfe.import',
      'customers.registry.view',
      'suppliers.registry.view',
      ...moduleCodes('vehicle-tracking'),
    ]),
  },
  {
    code: 'FISCAL',
    name: 'Fiscal',
    description:
      'Documentos fiscais e eventos de NF-e (cancelamento, CC-e, inutilização, reprocesso), manifestação do destinatário e NF-e de entrada; leitura do financeiro e das regras tributárias.',
    permissions: dedupe([
      'dashboard.finance.view',
      ...moduleCodes('fiscal').filter(
        (c) => !['fiscal.tax-rules.create', 'fiscal.tax-rules.update', 'fiscal.tax-rules.delete', 'fiscal.tributary-classifications.sync'].includes(c),
      ),
      'finance.entries.view',
      'finance.reports.view',
      ...resourceCodes('purchases', 'inbound-nfe'),
      'sales.orders.view',
      'sales.orders.invoice',
      'purchases.orders.view',
      'customers.registry.view',
      'suppliers.registry.view',
      'products.catalog.view',
    ]),
  },
  {
    code: 'RH',
    name: 'RH',
    description:
      'Gestão de usuários (ver, criar, editar — sem excluir; desativação é edição). Departamentos entram na fase 2 do multi-tenant (#347).',
    permissions: dedupe([
      'dashboard.executive.view',
      ...resourceCodes('settings', 'users'),
      'settings.companies.view',
    ]),
  },
  {
    code: 'QUALIDADE',
    name: 'Qualidade',
    description:
      'Inspeções e NCRs completos; quarentena/liberação/sucateamento de lotes e séries; aprova/reprova inspeções de produção. Equivale ao enum QUALITY.',
    permissions: dedupe([
      'dashboard.production.view',
      'dashboard.stock.view',
      ...moduleCodes('quality'),
      'production.orders.view',
      'production.orders.approve',
      'production.orders.reject',
      'stock.balances.view',
      'stock.batches.view',
      'stock.batches.create',
      'stock.batches.quarantine',
      'stock.batches.release',
      'stock.batches.scrap',
      'stock.batches.check-expired',
      'stock.serials.view',
      'stock.serials.scrap',
      'products.catalog.view',
      'suppliers.registry.view',
    ]),
  },
  {
    code: 'ASSISTENCIA_TECNICA',
    name: 'Assistência Técnica',
    description:
      'Manutenção completa (equipamentos e ordens); leitura de produtos, estoque e números de série (rastreabilidade).',
    permissions: dedupe([
      'dashboard.production.view',
      ...moduleCodes('maintenance'),
      'products.catalog.view',
      'stock.balances.view',
      'stock.serials.view',
      'stock.batches.view',
    ]),
  },

  // ── Nível Restrito ─────────────────────────────────────────────────────────
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description:
      'Vê TUDO (inclusive financeiro, comissões, usuários, LGPD, fila de aprovações e a trilha de auditoria iam.audit-logs) e exporta; nenhuma mutação.',
    permissions: dedupe([
      ...actionCodes('view'),
      'analytics.export.execute',
    ]),
  },
  {
    code: 'SOMENTE_LEITURA',
    name: 'Somente Leitura',
    description:
      'Leitura dos dados operacionais, sem nenhuma mutação e sem os módulos sensíveis (financeiro, comissões, usuários, LGPD, aprovações). Equivale ao enum READER.',
    permissions: VIEWS_NAO_SENSIVEIS,
  },
  {
    code: 'VISITANTE',
    name: 'Visitante',
    description: 'Apenas os dashboards operacionais (sem o financeiro). Nenhum dado detalhado.',
    permissions: [...DASHBOARDS_OPERACIONAIS],
  },

  // ── Loja / Filial — split controlado (decisão Rafael, #463) ────────────────
  // Em vez de um único perfil "Loja" poderoso, três perfis em cadeia de herança:
  // operação → faturamento → gerência. O faturamento (emitir NF-e) NÃO é
  // liberado automaticamente: exige atribuir LOJA_FATURAMENTO explicitamente.
  {
    code: 'LOJA_OPERACIONAL',
    name: 'Loja — Operação',
    description:
      'Operação de balcão da loja/filial: vende (criar/reservar/confirmar pedido), cadastra cliente, transferências entre filiais e solicitações de compra; leitura de produto, preço e estoque. NÃO fatura (sem NF-e), não devolve nem cancela venda. Escopo por filial via branchId. Recebe os usuários do enum STORE na migração (espelhamento 1:1).',
    permissions: dedupe([
      'dashboard.stock.view',
      'dashboard.sales.view',
      'sales.orders.view',
      'sales.orders.create',
      'sales.orders.reserve',
      'sales.orders.confirm',
      'customers.registry.view',
      'customers.registry.create',
      'stock.balances.view',
      'stock.transfers.view',
      'stock.transfers.create',
      'stock.transfers.dispatch',
      'stock.transfers.receive',
      'purchases.requests.view',
      'purchases.requests.create',
      'purchases.requests.cancel',
      'products.catalog.view',
      'products.pricing.view',
    ]),
  },
  {
    code: 'LOJA_FATURAMENTO',
    name: 'Loja — Faturamento',
    description:
      'Herda Loja — Operação e acrescenta faturar/emitir NF-e do pedido de venda + leitura de documentos fiscais. NÃO cancela NF-e nem faz financeiro. Atribuído manualmente pelo admin a quem realmente fatura na loja (faturamento não é liberado a todo usuário de loja).',
    parentCode: 'LOJA_OPERACIONAL',
    permissions: [
      'sales.orders.invoice',
      'fiscal.documents.view',
    ],
  },
  {
    code: 'GERENTE_LOJA',
    name: 'Gerente de Loja',
    description:
      'Herda Loja — Faturamento e acrescenta visão gerencial da filial: dashboards, acompanhamento de vendas/estoque, orçamentos, comissões e alertas. NÃO inclui devolução/cancelamento sensível de venda (reservado para permissão/fase futura) nem cancelamento fiscal crítico. Escopo por filial via branchId.',
    parentCode: 'LOJA_FATURAMENTO',
    permissions: dedupe([
      'dashboard.executive.view',
      'dashboard.purchases.view',
      ...resourceCodes('dashboard', 'alerts'),
      'stock.movements.view',
      'sales.quotations.view',
      'sales.commissions.view',
      'analytics.dashboards.view',
      'analytics.reports.view',
    ]),
  },
];

/**
 * Mapeamento 1:1 do enum `UserRole` atual → code do perfil system equivalente
 * (Parte 4.2 da arquitetura, coluna 4 na direção inversa). Usado pelo
 * espelhamento automático do seed: cada usuário ganha um UserRoleAssignment
 * apontando para o perfil equivalente ao seu `User.role`.
 *
 * Chaves em string (e não `UserRole` do @prisma/client) para o catálogo não
 * depender do client gerado; o seed valida contra o enum real.
 */
export const ENUM_ROLE_TO_SYSTEM_ROLE: Record<string, string> = {
  SUPER_ADMIN: 'ADMIN_GLOBAL',
  DIRECTOR: 'DIRETOR',
  // MANAGER = "Gerente Geral" no negócio (não "Gerente Industrial") — decisão
  // Rafael #463. GERENTE_INDUSTRIAL segue no catálogo para uso real em gerência
  // industrial, mas o enum antigo mapeia para o perfil amplo GERENTE_GERAL.
  MANAGER: 'GERENTE_GERAL',
  COMMERCIAL: 'VENDEDOR',
  PRODUCTION: 'OPERADOR_PCP',
  QUALITY: 'QUALIDADE',
  WAREHOUSE: 'ALMOXARIFE',
  FINANCIAL: 'FINANCEIRO',
  STORE: 'LOJA_OPERACIONAL',
  READER: 'SOMENTE_LEITURA',
};

/** Busca um perfil system por code */
export function findSystemRole(code: string): SystemRoleDef | undefined {
  return SYSTEM_ROLES.find((role) => role.code === code);
}

/**
 * Resolve o conjunto EFETIVO de permissões de um perfil, seguindo a cadeia de
 * herança (parent → child). Útil para testes e para o shadow mode (#340).
 */
export function resolveEffectivePermissions(code: string): string[] {
  const seen = new Set<string>();
  const result = new Set<string>();
  let current = findSystemRole(code);
  while (current) {
    if (seen.has(current.code)) {
      throw new Error(`Ciclo de herança detectado em '${current.code}'`);
    }
    seen.add(current.code);
    current.permissions.forEach((p) => result.add(p));
    current = current.parentCode ? findSystemRole(current.parentCode) : undefined;
  }
  return [...result];
}
