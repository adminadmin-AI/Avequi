/**
 * Catálogo de ENTITLEMENTS do SaaS — OPS WP4 (#911).
 *
 * FONTE DA VERDADE das keys, como o permissions.catalog é para RBAC: o banco
 * (Plan.entitlements / TenantEntitlementOverride) nunca inventa key que o
 * código não conhece — escrita valida contra este catálogo; leitura ignora
 * keys desconhecidas (fail-closed: desconhecido = desligado).
 *
 * Entitlement ≠ permissão: permissão é "o que ESTE USUÁRIO pode fazer";
 * entitlement é "o que ESTA CONTA contratou". O PermissionGuard continua
 * decidindo por usuário; o EntitlementGuard corta ANTES por conta.
 *
 * bool  = módulo ligado/desligado no plano.
 * limit = número (null = ilimitado).
 */

export type EntitlementValue = boolean | number | null;

export interface EntitlementDef {
  key: string;
  type: 'bool' | 'limit';
  name: string; // pt-BR — exibido no portal da operadora
  description?: string;
}

export const ENTITLEMENTS_CATALOG: EntitlementDef[] = [
  {
    key: 'crm',
    type: 'bool',
    name: 'CRM de Lojas',
    description: 'Captação multicanal, WhatsApp, pipeline e carteira (#506)',
  },
  {
    key: 'renave',
    type: 'bool',
    name: 'RENAVE / BIN',
    description:
      'Automação BIN + ATPV-e (#527). NOTA: o runtime fiscal continua gateado ' +
      'por Company.renaveEnabled + homologação SERPRO; este entitlement é o ' +
      'gate COMERCIAL (aparecer no plano) — a unificação fica pra quando o ' +
      'fiscal puder ser tocado (fora do WP4 de propósito, go-live #483).',
  },
  {
    key: 'suporteIa',
    type: 'bool',
    name: 'Suporte com triagem IA',
    description: 'Intake e triagem de bugs assistida por IA (#764)',
  },
  {
    key: 'tef',
    type: 'bool',
    name: 'TEF / Cartões',
    description: 'Meios de pagamento — cartão presente, multi-adquirente (#583)',
  },
  {
    key: 'maxUsers',
    type: 'limit',
    name: 'Limite de usuários',
    description: 'Usuários ativos da conta (matriz + filiais). null = ilimitado',
  },
];

export const ENTITLEMENT_KEYS: ReadonlySet<string> = new Set(
  ENTITLEMENTS_CATALOG.map((e) => e.key),
);

export function entitlementDef(key: string): EntitlementDef | undefined {
  return ENTITLEMENTS_CATALOG.find((e) => e.key === key);
}

/** Valida um mapa { key: valor } contra o catálogo (usado na escrita). */
export function validateEntitlements(map: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    const def = entitlementDef(key);
    if (!def) {
      errors.push(`key desconhecida: '${key}'`);
      continue;
    }
    if (def.type === 'bool' && typeof value !== 'boolean') {
      errors.push(`'${key}' deve ser boolean`);
    }
    if (def.type === 'limit' && value !== null && (typeof value !== 'number' || value < 0 || !Number.isInteger(value))) {
      errors.push(`'${key}' deve ser inteiro ≥ 0 ou null (ilimitado)`);
    }
  }
  return errors;
}

/**
 * Templates dos 3 planos iniciais — materializados pelo seed (upsert por
 * code; entitlements do plano SYSTEM são reconciliados com este template,
 * mesma filosofia do iam.seed).
 */
export const PLAN_TEMPLATES = [
  {
    code: 'ESSENCIAL',
    name: 'Essencial',
    description: 'ERP industrial: produção, estoque, compras, vendas, fiscal e financeiro.',
    entitlements: { crm: false, renave: false, suporteIa: false, tef: false, maxUsers: 10 },
  },
  {
    code: 'PROFISSIONAL',
    name: 'Profissional',
    description: 'Essencial + CRM de Lojas, suporte com IA e TEF.',
    entitlements: { crm: true, renave: false, suporteIa: true, tef: true, maxUsers: 25 },
  },
  {
    code: 'INDUSTRIAL',
    name: 'Industrial',
    description: 'Tudo incluso, usuários ilimitados. Plano da GDR.',
    entitlements: { crm: true, renave: true, suporteIa: true, tef: true, maxUsers: null },
  },
] as const;
