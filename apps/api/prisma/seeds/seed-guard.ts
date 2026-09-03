/**
 * Guards dos seeds — Onda 0, higiene do seed IAM.
 *
 * Dois tipos de seed, duas regras:
 *
 * - ESTRUTURAL (cClassTrib, IAM v2, planos SaaS): reconcilia configuração
 *   REAL (perfis system, permissões, entitlements). Em produção só roda com
 *   liberação explícita (ALLOW_PROD_SEED=true) — não é "inofensivo".
 * - DEMO (empresas/usuários/catálogo fictícios): HARD-BLOCKED em produção,
 *   sem nenhuma flag de override. Produção nunca recebe conta de demonstração.
 *
 * Além do ambiente, o demo é obrigado a usar identidades fictícias: e-mails
 * dos domínios reais da operação e nomes que pareçam empresa real são
 * rejeitados antes de qualquer escrita.
 */

export type SeedKind = 'structural' | 'demo';

/** Subconjunto de process.env que os seeds leem (tudo opcional, como na env real). */
export interface SeedEnv {
  NODE_ENV?: string;
  ALLOW_PROD_SEED?: string;
  SEED_USER_PASSWORD?: string;
}

/** Domínios de e-mail das empresas reais — proibidos em qualquer dado demo. */
export const REAL_EMAIL_DOMAINS: ReadonlyArray<string> = ['gdr.com.br', 'crd.com.br'];

/** Trechos de nome que denunciam empresa real — proibidos em nome/razão social demo. */
export const REAL_COMPANY_MARKERS: ReadonlyArray<RegExp> = [/\bgdr\b/i, /\bcrd\b/i, /reboques?/i, /avecchi/i, /avequi/i];

export class SeedBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedBlockedError';
  }
}

function isProduction(env: SeedEnv): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Decide se um seed pode rodar neste ambiente. Lança SeedBlockedError antes
 * de qualquer acesso ao banco.
 */
export function assertSeedAllowed(kind: SeedKind, env: SeedEnv = process.env): void {
  if (!isProduction(env)) return;

  if (kind === 'demo') {
    throw new SeedBlockedError(
      'Seed de DEMONSTRAÇÃO bloqueado em produção. Não existe flag de liberação: ' +
        'dados fictícios (empresas, usuários, catálogo) nunca entram em produção. ' +
        'Administrador real nasce pelo convite de tenant, não por seed.',
    );
  }

  if (env.ALLOW_PROD_SEED !== 'true') {
    throw new SeedBlockedError(
      'Seed ESTRUTURAL bloqueado em produção. Ele reconcilia perfis, permissões e planos ' +
        'reais; se a intenção é mesmo aplicar em produção, rode com ALLOW_PROD_SEED=true ' +
        'dentro da governança de release.',
    );
  }
}

/** E-mail de dado demo não pode pertencer a domínio real. */
export function assertDemoIdentity(email: string): void {
  const domain = String(email).toLowerCase().split('@')[1] ?? '';
  if (!domain || REAL_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    throw new SeedBlockedError(
      `Identidade demo inválida: "${email}" usa domínio real (${REAL_EMAIL_DOMAINS.join(', ')}). ` +
        'Dados de demonstração precisam de e-mail explicitamente fictício.',
    );
  }
}

/** Nome/razão social de empresa demo não pode parecer empresa real. */
export function assertDemoCompanyName(name: string): void {
  if (REAL_COMPANY_MARKERS.some((re) => re.test(name))) {
    throw new SeedBlockedError(
      `Nome de empresa demo inválido: "${name}" parece empresa real. Use nome explicitamente fictício.`,
    );
  }
}

/** Senha dos usuários demo: sempre da env, nunca do código, nunca com default. */
export function demoPasswordFromEnv(env: SeedEnv = process.env): string {
  const senha = env.SEED_USER_PASSWORD;
  if (!senha) {
    throw new SeedBlockedError(
      'SEED_USER_PASSWORD não definida. O seed demo não cria usuário com senha padrão — ' +
        'defina uma senha forte na env antes de rodar (ex.: export SEED_USER_PASSWORD="$(openssl rand -base64 18)").',
    );
  }
  return senha;
}
