/**
 * Rótulos pt-BR dos módulos do catálogo de permissões (#352).
 * O backend entrega o code técnico (ex.: 'vehicle-tracking'); a árvore da UI
 * mostra o rótulo humano. Módulo fora do mapa cai no próprio code.
 */
export const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboards',
  analytics: 'Inteligência e Relatórios',
  products: 'Produtos',
  customers: 'Clientes',
  suppliers: 'Fornecedores',
  sales: 'Comercial',
  purchases: 'Suprimentos',
  stock: 'Estoque',
  production: 'Produção',
  quality: 'Qualidade',
  maintenance: 'Manutenção',
  finance: 'Financeiro',
  fiscal: 'Fiscal',
  settings: 'Configurações',
  approvals: 'Aprovações',
  lgpd: 'LGPD',
  iam: 'Segurança e Acessos',
  'vehicle-tracking': 'Rastreio Veicular',
};

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}
