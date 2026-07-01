import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BadgeCheck,
  BarChart3,
  Barcode,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  Factory,
  FileInput,
  FileSpreadsheet,
  FileText,
  Gauge,
  Handshake,
  History,
  Landmark,
  LayoutDashboard,
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
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** se definido, o item só aparece para esses papéis */
  roles?: string[];
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
      { href: '/app/products', label: 'Produtos', icon: Package },
      { href: '/app/customers', label: 'Clientes', icon: Users },
      { href: '/app/suppliers', label: 'Fornecedores', icon: Handshake },
    ],
  },
  {
    key: 'comercial',
    title: 'Comercial',
    items: [
      { href: '/app/sales', label: 'Ordens de Venda', icon: ShoppingCart },
      { href: '/app/quotations', label: 'Cotações', icon: FileText },
    ],
  },
  {
    key: 'estoque',
    title: 'Estoque',
    items: [
      { href: '/app/stock', label: 'Saldos', icon: Boxes },
      { href: '/app/stock/movements', label: 'Movimentações', icon: ArrowLeftRight },
      { href: '/app/stock/transfers', label: 'Transferências', icon: Truck },
      { href: '/app/stock/locations', label: 'Localizações', icon: MapPin },
      { href: '/app/stock/wms', label: 'Tarefas WMS', icon: ClipboardList },
    ],
  },
  {
    key: 'producao',
    title: 'Produção',
    items: [
      { href: '/app/production', label: 'Ordens de Produção', icon: Factory },
      { href: '/app/production/bom', label: 'BOM', icon: Network },
      { href: '/app/production/mrp', label: 'MRP', icon: Calculator },
      { href: '/app/production/routing', label: 'Roteiros', icon: Workflow },
      { href: '/app/production/work-centers', label: 'Centros de Trabalho', icon: Gauge },
    ],
  },
  {
    key: 'suprimentos',
    title: 'Suprimentos',
    items: [
      { href: '/app/purchases', label: 'Pedidos de Compra', icon: PackageOpen },
      { href: '/app/purchases/automation', label: 'Automação', icon: Zap },
      { href: '/app/purchases/inbound-nfe', label: 'NF-e de Entrada', icon: FileInput },
      { href: '/app/approvals', label: 'Aprovações', icon: BadgeCheck },
    ],
  },
  {
    key: 'qualidade',
    title: 'Qualidade',
    items: [
      { href: '/app/quality', label: 'Dashboard', icon: ShieldCheck },
      { href: '/app/quality/inspections', label: 'Inspeções', icon: ClipboardCheck },
      { href: '/app/quality/ncr', label: 'Não Conformidades', icon: AlertTriangle },
    ],
  },
  {
    key: 'manutencao',
    title: 'Manutenção',
    items: [{ href: '/app/maintenance', label: 'Ordens de Manutenção', icon: Wrench }],
  },
  {
    key: 'fiscal',
    title: 'Fiscal',
    items: [{ href: '/app/fiscal', label: 'Documentos Fiscais', icon: ScrollText }],
  },
  {
    key: 'financeiro',
    title: 'Financeiro',
    items: [
      { href: '/app/finance/receivables', label: 'Recebíveis', icon: Wallet },
      { href: '/app/finance/payables', label: 'Pagáveis', icon: CreditCard },
      { href: '/app/finance/cash-flow', label: 'Fluxo de Caixa', icon: LineChart },
      { href: '/app/finance/bank-accounts', label: 'Contas Bancárias', icon: Landmark },
      { href: '/app/finance/reconciliation', label: 'Conciliação', icon: Scale },
      { href: '/app/finance/collection-tools', label: 'Cobranças', icon: Barcode },
      { href: '/app/finance/collection', label: 'Monitor de Cobrança', icon: Activity },
      { href: '/app/finance/scheduled-payments', label: 'Agendamentos', icon: CalendarClock },
      { href: '/app/finance/settings', label: 'Categorias / CC', icon: SlidersHorizontal },
    ],
  },
  {
    key: 'inteligencia',
    title: 'Inteligência',
    items: [
      { href: '/app/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/app/reports', label: 'Relatórios', icon: FileSpreadsheet },
      { href: '/app/alerts', label: 'Alertas', icon: Bell },
    ],
  },
  {
    key: 'config',
    title: 'Configurações',
    items: [
      { href: '/app/settings/users', label: 'Usuários', icon: UserCog },
      { href: '/app/settings/warehouses', label: 'Depósitos', icon: Warehouse },
      { href: '/app/settings/company', label: 'Empresa', icon: Building2 },
      { href: '/app/settings/audit', label: 'Log de Auditoria', icon: History, roles: ['SUPER_ADMIN'] },
    ],
  },
];

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

/** Todos os itens de navegação achatados (busca da sidebar + command palette). */
export function flatNav(role?: string): NavItem[] {
  return NAV.flatMap((s) => s.items).filter(
    (it) => !it.roles || (role ? it.roles.includes(role) : false),
  );
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
  let best: string | null = null;
  for (const item of NAV.flatMap((s) => s.items)) {
    if (!isActive(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
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
  edit: 'Editar',
  receive: 'Recebimento',
  'work-centers': 'Centros de Trabalho',
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
  users: 'Usuários',
  warehouses: 'Depósitos',
  company: 'Empresa',
  approvals: 'Aprovações',
  quotations: 'Cotações',
  reports: 'Relatórios',
  alerts: 'Alertas',
  dashboard: 'Dashboard',
};

export interface Crumb {
  label: string;
  href: string;
  /** segmento que parece um id (não navegável de forma útil) */
  isId?: boolean;
}

/** Gera breadcrumbs a partir do pathname (#305). */
export function buildBreadcrumbs(pathname: string): Crumb[] {
  const hrefByItem = new Map(NAV.flatMap((s) => s.items).map((it) => [it.href, it.label]));
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
