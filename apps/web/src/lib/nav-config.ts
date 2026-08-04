import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  Barcode,
  Bell,
  Bot,
  Boxes,
  Building,
  Building2,
  CalendarClock,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Crown,
  Factory,
  FileInput,
  FileSpreadsheet,
  FileText,
  Gauge,
  ScanBarcode,
  Handshake,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LineChart,
  MapPin,
  Network,
  Package,
  PackageOpen,
  Plus,
  ScrollText,
  Scale,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  Workflow,
  Wrench,
  Zap,
  MessageCircle,
  MessageSquareText,
  KanbanSquare,
  Settings2,
  Timer,
  Tags,
  Layers,
  TrendingUp,
  Target,
  Coins,
  PackageCheck,
  Percent,
  Store,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Permissão RBAC v2 (#351) que libera a rota (e sub-rotas): o MESMO campo
   * esconde o item do menu (sidebar/command palette) E bloqueia a rota no
   * RouteGuard. Use o code do endpoint de listagem que a página consome
   * (ex.: `sales.orders.view` ← GET /sales). Aceita wildcard de sufixo.
   *
   * Quando definido, SUBSTITUI `roles` (a matriz v2 expressa perfis que o
   * enum legado não tem, ex.: ADMIN_EMPRESA/AUDITOR). Enquanto as permissões
   * do usuário carregam, o item fica oculto e a rota segura render
   * (fail-closed, igual ao hook usePermission).
   *
   * ⚠️ Isso é defesa de UX, não de segurança — a segurança real é o backend
   * (@RequirePermission + PermissionGuard).
   */
  permission?: string;
  /**
   * (Legado #453) Restringe a esses papéis do enum. Bloco F (#624) migrou o
   * CRM — NENHUM item usa mais este campo. O campo e o branch em
   * navItemAllowed/checkRouteAccess podem ser removidos em follow-up
   * (mantidos aqui só para não inflar o escopo do PR do CRM).
   * Sem `roles` e sem `permission` = liberado para qualquer autenticado.
   */
  roles?: string[];
  /**
   * (OPS WP4 #911) Entitlement (key do catálogo, sempre `bool`) que a CONTA
   * precisa ter contratado — checado em CIMA de `permission`/`roles` (E
   * lógico, não substitui). Ex.: `entitlement: 'crm'` esconde o menu do CRM
   * de contas sem o módulo, mesmo que o usuário tenha a permissão.
   *
   * Fail-closed igual ao `permission`: sem dado de entitlements carregado
   * (ainda buscando ou falhou) → item oculto. Conta LEGADO (sem plano, ver
   * GET /entitlements/me) libera todos os entitlements.
   *
   * ⚠️ Isso é defesa de UX — o backend sempre revalida (@RequireEntitlement +
   * EntitlementGuard).
   */
  entitlement?: string;
}

/**
 * Contexto de acesso para filtrar o NAV — quem fornece é quem tem hooks
 * (sidebar/palette/guard, via usePermission + useAuthStore).
 * `can` undefined = permissões ainda não carregadas → itens com `permission`
 * ficam ocultos (fail-closed); itens legados por `roles` seguem funcionando.
 * `hasEntitlement` ausente/undefined = mesma semântica fail-closed para itens
 * com `entitlement` (OPS WP4 #911).
 */
export interface NavAccess {
  role?: string | null;
  can?: (code: string) => boolean;
  hasEntitlement?: (key: string) => boolean;
}

/** O item deve aparecer/liberar para este contexto? (fonte única, #351) */
export function navItemAllowed(item: NavItem, access: NavAccess): boolean {
  if (item.permission) {
    if (!access.can || !access.can(item.permission)) return false;
  } else if (item.roles) {
    if (!access.role || !item.roles.includes(access.role)) return false;
  }
  if (item.entitlement) {
    if (!access.hasEntitlement || !access.hasEntitlement(item.entitlement)) return false;
  }
  return true;
}

export interface NavSection {
  /** chave estável p/ persistir estado de colapso */
  key: string;
  title?: string;
  items: NavItem[];
}

/**
 * Navegação principal do app. Fonte única consumida pela sidebar (#304),
 * pelos breadcrumbs (#305) e pelo command palette (#305).
 * Ícones únicos por item (resolve o Factory/Gauge/FileText duplicados).
 */
export const NAV: NavSection[] = [
  {
    key: 'home',
    items: [{ href: '/app', label: 'Início', icon: LayoutDashboard }],
  },
  {
    key: 'cadastros',
    title: 'Cadastros',
    items: [
      { href: '/app/products', label: 'Produtos', icon: Package, permission: 'products.catalog.view' },
      { href: '/app/customers', label: 'Clientes', icon: Users, permission: 'customers.registry.view' },
      { href: '/app/suppliers', label: 'Fornecedores', icon: Handshake, permission: 'suppliers.registry.view' },
      { href: '/app/carriers', label: 'Transportadoras', icon: Truck, permission: 'sales.carriers.view' },
    ],
  },
  {
    key: 'comercial',
    title: 'Comercial',
    items: [
      // Bloco F (#624): CRM migrado do `roles` legado (e de itens sem gate)
      // para `permission:` — perfis sem CRM deixam de ver o menu (D4).
      // OPS WP4 (#911): + `entitlement: 'crm'` — some do menu quando a CONTA
      // não contratou o módulo (backend espelha com @RequireEntitlement('crm')).
      { href: '/app/crm/inbox', label: 'Inbox WhatsApp', icon: MessageCircle, permission: 'crm.conversations.view', entitlement: 'crm' },
      { href: '/app/crm/funnel', label: 'Funil', icon: KanbanSquare, permission: 'crm.leads.view', entitlement: 'crm' },
      { href: '/app/crm/leads', label: 'Leads', icon: ClipboardList, permission: 'crm.leads.list', entitlement: 'crm' },
      { href: '/app/crm/quick-replies', label: 'Respostas rápidas', icon: MessageSquareText, permission: 'crm.quick-replies.manage', entitlement: 'crm' },
      { href: '/app/crm/dashboard', label: 'Dashboard CRM', icon: BarChart3, permission: 'crm.dashboard.view', entitlement: 'crm' },
      { href: '/app/crm/sdr', label: 'SDR IA', icon: Bot, permission: 'crm.sdr.monitor', entitlement: 'crm' },
      { href: '/app/crm/settings', label: 'Config CRM', icon: Settings2, permission: 'crm.settings.view', entitlement: 'crm' },
      { href: '/app/crm/sla', label: 'SLA & Alertas', icon: Timer, permission: 'crm.leads.view', entitlement: 'crm' },
      { href: '/app/sales', label: 'Ordens de Venda', icon: ShoppingCart, permission: 'sales.orders.view' },
      { href: '/app/sales/counter', label: 'Venda Balcão', icon: Store, permission: 'sales.orders.create' },
      { href: '/app/quotations', label: 'Cotações', icon: FileText, permission: 'sales.quotations.view' },
      { href: '/app/shipping', label: 'Expedição', icon: PackageCheck, permission: 'sales.deliveries.view' },
    ],
  },
  {
    key: 'estoque',
    title: 'Estoque',
    items: [
      { href: '/app/stock', label: 'Saldos', icon: Boxes, permission: 'stock.balances.view' },
      { href: '/app/stock/movements', label: 'Movimentações', icon: ArrowLeftRight, permission: 'stock.movements.view' },
      { href: '/app/stock/transfers', label: 'Transferências', icon: Truck, permission: 'stock.transfers.view' },
      { href: '/app/stock/locations', label: 'Localizações', icon: MapPin, permission: 'stock.warehouses.view' },
      { href: '/app/stock/wms', label: 'Tarefas WMS', icon: ClipboardList, permission: 'stock.wms.view' },
    ],
  },
  {
    key: 'producao',
    title: 'Produção',
    items: [
      { href: '/app/production', label: 'Ordens de Produção', icon: Factory, permission: 'production.orders.view' },
      { href: '/app/production/bom', label: 'BOM', icon: Network, permission: 'production.bom.view' },
      { href: '/app/production/mrp', label: 'MRP', icon: Calculator, permission: 'production.mrp.view' },
      { href: '/app/production/routing', label: 'Roteiros', icon: Workflow, permission: 'production.routing.view' },
      { href: '/app/production/work-centers', label: 'Centros de Trabalho', icon: Gauge, permission: 'production.work-centers.view' },
      { href: '/app/production/chassis', label: 'Chassis', icon: ScanBarcode, permission: 'production.chassi.view' },
    ],
  },
  {
    key: 'suprimentos',
    title: 'Suprimentos',
    items: [
      { href: '/app/purchases', label: 'Pedidos de Compra', icon: PackageOpen, permission: 'purchases.orders.view' },
      { href: '/app/purchases/automation', label: 'Automação', icon: Zap },
      { href: '/app/purchases/inbound-nfe', label: 'NF-e de Entrada', icon: FileInput, permission: 'purchases.inbound-nfe.view' },
      { href: '/app/approvals', label: 'Aprovações', icon: BadgeCheck, permission: 'approvals.requests.view' },
    ],
  },
  {
    key: 'qualidade',
    title: 'Qualidade',
    items: [
      { href: '/app/quality', label: 'Dashboard', icon: ShieldCheck, permission: 'quality.reports.view' },
      { href: '/app/quality/inspections', label: 'Inspeções', icon: ClipboardCheck, permission: 'quality.inspections.view' },
      { href: '/app/quality/ncr', label: 'Não Conformidades', icon: AlertTriangle, permission: 'quality.ncr.view' },
    ],
  },
  {
    key: 'manutencao',
    title: 'Manutenção',
    items: [{ href: '/app/maintenance', label: 'Ordens de Manutenção', icon: Wrench, permission: 'maintenance.orders.view' }],
  },
  {
    key: 'fiscal',
    title: 'Fiscal',
    items: [
      { href: '/app/fiscal', label: 'Documentos Fiscais', icon: ScrollText, permission: 'fiscal.documents.view' },
      { href: '/app/fiscal/rules', label: 'Regras Fiscais', icon: Scale, permission: 'fiscal.tax-rules.view' },
      { href: '/app/fiscal/compliance', label: 'Conformidade', icon: ShieldCheck, permission: 'fiscal.documents.view' },
    ],
  },
  {
    key: 'financeiro',
    title: 'Financeiro',
    items: [
      { href: '/app/finance/receivables', label: 'Recebíveis', icon: Wallet, permission: 'finance.entries.view' },
      { href: '/app/finance/payables', label: 'Pagáveis', icon: CreditCard, permission: 'finance.entries.view' },
      { href: '/app/finance/cash-flow', label: 'Fluxo de Caixa', icon: LineChart, permission: 'finance.reports.view' },
      { href: '/app/finance/pricing', label: 'Formação de Preço', icon: Tags, permission: 'products.pricing.view' },
      { href: '/app/finance/costing', label: 'Custeio por Absorção', icon: Layers, permission: 'products.pricing.view' },
      { href: '/app/finance/forecast', label: 'Forecast Financeiro', icon: TrendingUp, permission: 'finance.reports.view' },
      { href: '/app/finance/budget-plans', label: 'Budget por Drivers', icon: Target, permission: 'finance.budget-plans.view' },
      { href: '/app/finance/investments', label: 'Análise de Investimentos', icon: Coins, permission: 'finance.investments.view' },
      { href: '/app/finance/bank-accounts', label: 'Contas Bancárias', icon: Landmark, permission: 'finance.bank-accounts.view' },
      { href: '/app/finance/acquirers', label: 'Adquirentes & Taxas', icon: Percent, permission: 'finance.acquirers.view' },
      { href: '/app/finance/reconciliation', label: 'Conciliação', icon: Scale, permission: 'finance.banking.view' },
      { href: '/app/finance/collection-tools', label: 'Cobranças', icon: Barcode, permission: 'finance.boletos.view' },
      { href: '/app/finance/collection', label: 'Monitor de Cobrança', icon: Activity, permission: 'finance.billing.view' },
      { href: '/app/finance/scheduled-payments', label: 'Agendamentos', icon: CalendarClock, permission: 'finance.payment-schedules.view' },
      { href: '/app/finance/settings', label: 'Categorias / CC', icon: SlidersHorizontal, permission: 'finance.categories.view' },
    ],
  },
  {
    key: 'inteligencia',
    title: 'Inteligência',
    items: [
      { href: '/app/analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.dashboards.view' },
      { href: '/app/reports', label: 'Relatórios', icon: FileSpreadsheet, permission: 'analytics.reports.view' },
      { href: '/app/alerts', label: 'Alertas', icon: Bell, permission: 'dashboard.alerts.view' },
    ],
  },
  {
    key: 'config',
    title: 'Configurações',
    items: [
      { href: '/app/settings/users', label: 'Usuários', icon: UserCog, permission: 'settings.users.view' },
      { href: '/app/settings/roles', label: 'Perfis e Permissões', icon: KeyRound, permission: 'iam.roles.view' },
      { href: '/app/settings/organization', label: 'Organização', icon: Network, permission: 'iam.org.view' },
      { href: '/app/settings/warehouses', label: 'Depósitos', icon: Warehouse, permission: 'stock.warehouses.view' },
      { href: '/app/settings/company', label: 'Empresa', icon: Building2, permission: 'settings.companies.view' },
      { href: '/app/settings/audit', label: 'Log de Auditoria', icon: History, permission: 'iam.audit-logs.view' },
    ],
  },
  {
    key: 'suporte',
    title: 'Suporte',
    items: [
      // Self-service (épico #764): reportar/ver os PRÓPRIOS chamados não tem
      // gate de permissão — liberado para qualquer autenticado, coerente com
      // o backend (SupportController sem @RequirePermission).
      { href: '/app/support', label: 'Meus chamados', icon: LifeBuoy },
    ],
  },
  {
    key: 'operadora',
    title: 'Operadora',
    items: [
      // Control plane cross-tenant da Avecchi (OPS WP1 #908 / WP2 #909) —
      // NUNCA entra em perfil de tenant (tenantPermissionCodes() exclui o
      // módulo `ops` inteiro); só quem tem ops.tenants.view vê este item.
      //
      // OPS F2: as rotas do control plane saíram daqui e viraram um console
      // próprio (OPS_NAV + OpsSidebar) — "mesma conta, consoles separados".
      // No ERP do tenant sobra UMA porta de entrada, com o mesmo gate de
      // antes: quem não tem ops.tenants.view continua sem ver nada.
      { href: '/app/ops', label: 'Portal Avecchi', icon: Building, permission: 'ops.tenants.view' },
    ],
  },
];

/**
 * Navegação do CONSOLE DA OPERADORA (OPS F2) — control plane SaaS da
 * Avecchi, renderizado pela `OpsSidebar` quando o pathname está sob
 * `/app/ops`. Vive FORA do `NAV` de propósito: controlar clientes SaaS não
 * é um menu dentro do ERP de um cliente (padrão Google Admin/Stripe).
 *
 * Os gates são os MESMOS que o backend exige em cada rota — nada aqui
 * afrouxa permissão: `ops.tenants.view` (painel, listagem e detalhe),
 * `ops.tenants.provision` (wizard de onboarding, = @RequirePermission dos
 * endpoints de provisionamento), `ops.plans.view` e `ops.billing.view`.
 *
 * ⚠️ O painel (#957) fica em `ops.tenants.view` de propósito: a metade
 * FINANCEIRA da tela se gateia sozinha por `ops.billing.view` (componente
 * por componente, via usePermission) — quem não fatura vê o painel de
 * carteira, não um "Acesso negado".
 *
 * Continua participando da resolução de rota/breadcrumbs via
 * `ALL_NAV_ITEMS` — o RouteGuard segue guardando as rotas ops mesmo elas
 * não estando mais no menu do ERP.
 */
export const OPS_NAV: NavSection[] = [
  {
    key: 'ops',
    items: [
      // Painel da Operadora (#957): a home do console virou o painel de
      // negócio do SaaS (MRR, carteira, inadimplência, alertas) e a lista de
      // contas desceu para /app/ops/tenants. `/app/ops` segue sendo o pouso
      // pós-login de quem tem permissão `ops.*` (ver login/page.tsx).
      { href: '/app/ops', label: 'Painel', icon: Gauge, permission: 'ops.tenants.view' },
      // A lista tem item PRÓPRIO (não é sub-rota herdada): sem ele, o
      // RouteGuard resolveria /app/ops/tenants pelo item pai — funciona, mas
      // o menu não acenderia certo e o breadcrumb sairia "Tenants".
      { href: '/app/ops/tenants', label: 'Contas de cliente', icon: Building2, permission: 'ops.tenants.view' },
      // OPS WP2 (#909): wizard de onboarding — gate espelha o backend
      // (POST /ops/tenants/** exige ops.tenants.provision).
      { href: '/app/ops/new', label: 'Nova conta', icon: Plus, permission: 'ops.tenants.provision' },
      // OPS WP4 (#911): catálogo de planos/entitlements do SaaS.
      { href: '/app/ops/plans', label: 'Planos', icon: Crown, permission: 'ops.plans.view' },
      // OPS WP5 (#912): billing da operadora — MRR, aging e faturas da carteira.
      { href: '/app/ops/billing', label: 'Billing', icon: CreditCard, permission: 'ops.billing.view' },
    ],
  },
];

/**
 * Todos os itens de navegação conhecidos — ERP (`NAV`) + console da
 * operadora (`OPS_NAV`) —, deduplicados por href: a porta de entrada no ERP
 * ("Portal Avecchi") e a home do console ("Painel", #957) apontam ambas para
 * `/app/ops`, e quem vence é a do ERP (declarada primeiro) — por isso o
 * breadcrumb do console diz "Portal Avecchi". As duas exigem a MESMA
 * permissão (`ops.tenants.view`), então a dedup não afrouxa gate nenhum.
 * É a fonte de resolução de rota, breadcrumbs e command palette; sem isto as
 * rotas ops perderiam o gate do RouteGuard ao saírem do menu do ERP (OPS F2).
 */
const ALL_NAV_ITEMS: NavItem[] = (() => {
  const seen = new Set<string>();
  const items: NavItem[] = [];
  for (const item of [...NAV, ...OPS_NAV].flatMap((s) => s.items)) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    items.push(item);
  }
  return items;
})();

/** Ações rápidas do command palette (#305). */
export interface QuickAction {
  label: string;
  href: string;
  icon: LucideIcon;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Nova Ordem de Venda', href: '/app/sales/new', icon: Plus },
  { label: 'Nova Cotação', href: '/app/quotations/new', icon: Plus },
  { label: 'Novo Pedido de Compra', href: '/app/purchases/new', icon: Plus },
  { label: 'Novo Produto', href: '/app/products', icon: Plus },
  { label: 'Novo Cliente', href: '/app/customers', icon: Plus },
  { label: 'Nova Transferência', href: '/app/stock/transfers/new', icon: Plus },
];

/**
 * Todos os itens de navegação achatados (busca da sidebar + command palette).
 * Inclui o console da operadora (OPS F2) — o palette é global e atravessa os
 * dois consoles; o filtro por permissão é quem esconde o que não é do usuário.
 */
export function flatNav(access: NavAccess): NavItem[] {
  return ALL_NAV_ITEMS.filter((it) => navItemAllowed(it, access));
}

export function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(href + '/');
}

/**
 * Href do item de navegação que melhor casa com o pathname atual — o mais
 * específico (prefixo mais longo). Evita que o item "raiz" de um grupo
 * (ex.: /app/stock) acenda junto com um filho (ex.: /app/stock/transfers),
 * mas mantém o pai ativo em páginas de detalhe sem item próprio (ex.:
 * /app/sales/123 mantém "Ordens de Venda"). Retorna null se nada casar.
 */
export function resolveActiveHref(pathname: string): string | null {
  return resolveRouteItem(pathname)?.href ?? null;
}

/**
 * Item de navegação mais específico (prefixo mais longo) que casa com o
 * pathname. Sub-rotas herdam o item pai: /app/sales/123 → item /app/sales,
 * /app/finance/payables/new → item /app/finance/payables. Retorna null se
 * nenhum item casar (rota não mapeada).
 */
export function resolveRouteItem(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const item of ALL_NAV_ITEMS) {
    if (!isActive(pathname, item.href)) continue;
    if (best === null || item.href.length > best.href.length) best = item;
  }
  return best;
}

export type RouteAccess =
  | { status: 'allowed' }
  /** rota com `permission` e as permissões do usuário ainda carregando */
  | { status: 'loading' }
  /** rota restrita e o usuário não tem acesso (por permissão OU por role) */
  | { status: 'denied'; roles: string[]; permission?: string }
  /** nenhum item de navegação casa com o pathname */
  | { status: 'unmapped' };

/**
 * Decide o acesso ao pathname, usando o MESMO mapa do menu (NAV) — fonte
 * única de verdade. Regras:
 * - item com `permission` → exige a permissão RBAC v2 (`access.can`);
 *   enquanto `can` não está disponível (fetch em andamento) → `loading`
 *   (o RouteGuard segura o render — fail-closed, sem flash de conteúdo);
 * - item com `roles` (legado) → exige que a role esteja na lista;
 * - item sem ambos → liberado para qualquer autenticado;
 * - rota não mapeada → `unmapped`; o RouteGuard LIBERA (para não quebrar
 *   páginas novas antes de entrarem no NAV) e loga warning em dev.
 *
 * Defesa de UX apenas — a autorização real acontece no backend.
 */
export function checkRouteAccess(pathname: string, access: NavAccess): RouteAccess {
  const item = resolveRouteItem(pathname);
  if (!item) return { status: 'unmapped' };
  if (item.permission) {
    if (!access.can) return { status: 'loading' };
    return access.can(item.permission)
      ? { status: 'allowed' }
      : { status: 'denied', roles: [], permission: item.permission };
  }
  if (!item.roles) return { status: 'allowed' };
  return access.role && item.roles.includes(access.role)
    ? { status: 'allowed' }
    : { status: 'denied', roles: item.roles };
}

/**
 * Rótulos pt-BR para segmentos de path que não são itens de navegação
 * (intermediários e páginas de detalhe), usados nos breadcrumbs.
 */
const SEGMENT_LABELS: Record<string, string> = {
  app: 'Início',
  finance: 'Financeiro',
  stock: 'Estoque',
  production: 'Produção',
  purchases: 'Suprimentos',
  quality: 'Qualidade',
  settings: 'Configurações',
  sales: 'Comercial',
  maintenance: 'Manutenção',
  fiscal: 'Fiscal',
  analytics: 'Analytics',
  new: 'Novo',
  counter: 'Venda Balcão',
  compliance: 'Conformidade',
  acquirers: 'Adquirentes & Taxas',
  edit: 'Editar',
  receive: 'Recebimento',
  'work-centers': 'Centros de Trabalho',
  chassis: 'Chassis',
  'bank-accounts': 'Contas Bancárias',
  'cash-flow': 'Fluxo de Caixa',
  'collection-tools': 'Cobranças',
  collection: 'Monitor de Cobrança',
  reconciliation: 'Conciliação',
  'scheduled-payments': 'Agendamentos',
  'inbound-nfe': 'NF-e de Entrada',
  automation: 'Automação',
  movements: 'Movimentações',
  transfers: 'Transferências',
  locations: 'Localizações',
  wms: 'Tarefas WMS',
  bom: 'BOM',
  mrp: 'MRP',
  routing: 'Roteiros',
  inspections: 'Inspeções',
  ncr: 'Não Conformidades',
  audit: 'Log de Auditoria',
  roles: 'Perfis e Permissões',
  users: 'Usuários',
  warehouses: 'Depósitos',
  company: 'Empresa',
  approvals: 'Aprovações',
  quotations: 'Cotações',
  reports: 'Relatórios',
  alerts: 'Alertas',
  dashboard: 'Dashboard',
  billing: 'Billing',
};

export interface Crumb {
  label: string;
  href: string;
  /** segmento que parece um id (não navegável de forma útil) */
  isId?: boolean;
}

/** Gera breadcrumbs a partir do pathname (#305). */
export function buildBreadcrumbs(pathname: string): Crumb[] {
  const hrefByItem = new Map(ALL_NAV_ITEMS.map((it) => [it.href, it.label]));
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [];
  let acc = '';
  for (const seg of segments) {
    acc += '/' + seg;
    const isId = /^[0-9a-f]{8}-|^\d+$|^c[a-z0-9]{20,}$/i.test(seg);
    const label =
      hrefByItem.get(acc) ??
      SEGMENT_LABELS[seg] ??
      (isId ? `#${seg.slice(0, 8)}` : capitalize(seg));
    crumbs.push({ label, href: acc, isId });
  }
  return crumbs;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');
}
