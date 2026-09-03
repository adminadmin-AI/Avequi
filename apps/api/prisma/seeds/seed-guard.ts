/**
 * Guards dos seeds — Onda 0, higiene do seed IAM.
 *
 * Política FAIL-CLOSED em camadas. A URL de conexão diz apenas qual é o
 * ENDPOINT APARENTE: um `localhost` pode ser túnel SSH/proxy para um banco
 * remoto. Por isso a URL é só a primeira camada; o seed demo ainda exige
 * confirmação explícita e faz um preflight READ-ONLY do conteúdo do banco
 * (ver demo.seed.ts) antes de qualquer escrita.
 *
 * Camada 1 — endpoint aparente de DATABASE_URL (parseada antes da primeira
 * query): ausente, inválida, esquema ≠ postgres:// ou sem host → bloqueia.
 * "Loopback aparente" = somente localhost / 127.0.0.1 / ::1. Qualquer outro
 * host é tratado como remoto, seja qual for o NODE_ENV.
 *
 * - DEMO (empresas/usuários/catálogo fictícios) exige CONJUNTAMENTE:
 *     NODE_ENV === 'development' (exato: ausente/test/staging/production bloqueiam),
 *     DATABASE_URL válida com loopback aparente,
 *     CONFIRM_DEMO_SEED === 'true' (exato).
 *   A confirmação NÃO é override: não libera production nem host remoto; só
 *   atesta uma execução deliberada em desenvolvimento local. Não existe flag
 *   que libere o demo fora disso.
 * - ESTRUTURAL / IAM (cClassTrib, perfis system, permissões, planos): loopback
 *   aparente + NODE_ENV ≠ production roda normalmente. NODE_ENV=production OU
 *   endpoint não-loopback exigem ALLOW_PROD_SEED=true exato — o nome ficou por
 *   compatibilidade, mas a flag passou a ser exigida também para qualquer
 *   endpoint remoto (inclusive um Postgres/Supabase "de desenvolvimento"),
 *   porque o seed reconcilia configuração real.
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
  CONFIRM_DEMO_SEED?: string;
  SEED_USER_PASSWORD?: string;
  DATABASE_URL?: string;
}

/** Domínios de e-mail das empresas reais — proibidos em qualquer dado demo. */
export const REAL_EMAIL_DOMAINS: ReadonlyArray<string> = ['gdr.com.br', 'crd.com.br'];

/** Trechos de nome que denunciam empresa real — proibidos em nome/razão social demo. */
export const REAL_COMPANY_MARKERS: ReadonlyArray<RegExp> = [/\bgdr\b/i, /\bcrd\b/i, /reboques?/i, /avecchi/i, /avequi/i];

/** Hosts de loopback aparente. Nada além disso conta como local. */
export const LOOPBACK_DB_HOSTS: ReadonlyArray<string> = ['localhost', '127.0.0.1', '::1'];

/** Único NODE_ENV em que o seed demo pode rodar. */
export const DEMO_ALLOWED_NODE_ENV = 'development';

const DB_SCHEMES = new Set(['postgres:', 'postgresql:']);

export class SeedBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedBlockedError';
  }
}

export interface DatabaseEndpoint {
  /** 'loopback' = host aparente é localhost/127.0.0.1/::1; 'remote' = qualquer outro. */
  kind: 'loopback' | 'remote';
  host: string;
}

/**
 * Determina o ENDPOINT APARENTE de DATABASE_URL. Lança SeedBlockedError quando
 * a URL está ausente, não é postgres://, não parseia ou não tem host.
 * Não afirma nada sobre o banco por trás do endpoint (túnel/proxy são
 * indistinguíveis aqui). A mensagem nunca ecoa a URL (pode conter credencial).
 */
export function resolveDatabaseEndpoint(databaseUrl: string | undefined): DatabaseEndpoint {
  if (!databaseUrl || !databaseUrl.trim()) {
    throw new SeedBlockedError('Seed bloqueado: DATABASE_URL ausente — o endpoint do banco precisa ser conhecido antes de qualquer seed.');
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl.trim());
  } catch {
    throw new SeedBlockedError('Seed bloqueado: DATABASE_URL inválida (não parseável) — endpoint do banco indeterminável.');
  }
  if (!DB_SCHEMES.has(parsed.protocol)) {
    throw new SeedBlockedError(
      `Seed bloqueado: DATABASE_URL com esquema "${parsed.protocol}" não suportado (esperado postgres:// ou postgresql://).`,
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new SeedBlockedError('Seed bloqueado: DATABASE_URL sem host — endpoint do banco indeterminável.');
  }
  return { kind: LOOPBACK_DB_HOSTS.includes(host) ? 'loopback' : 'remote', host };
}

function isProduction(env: SeedEnv): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Decide se um seed pode rodar contra este ambiente + endpoint aparente.
 * Lança SeedBlockedError antes de qualquer acesso ao banco.
 */
export function assertSeedAllowed(kind: SeedKind, env: SeedEnv = process.env): DatabaseEndpoint {
  const endpoint = resolveDatabaseEndpoint(env.DATABASE_URL);

  if (kind === 'demo') {
    if (env.NODE_ENV !== DEMO_ALLOWED_NODE_ENV) {
      throw new SeedBlockedError(
        `Seed de DEMONSTRAÇÃO bloqueado: NODE_ENV=${env.NODE_ENV ?? '(ausente)'}. Só roda com NODE_ENV=development exato; ` +
          'não existe flag de liberação. Administrador real nasce pelo convite de tenant, não por seed.',
      );
    }
    if (endpoint.kind !== 'loopback') {
      throw new SeedBlockedError(
        `Seed de DEMONSTRAÇÃO bloqueado: DATABASE_URL aponta para endpoint não-loopback (${endpoint.host}). ` +
          'O demo só roda contra localhost / 127.0.0.1 / ::1; não existe flag de liberação para outros hosts.',
      );
    }
    if (env.CONFIRM_DEMO_SEED !== 'true') {
      throw new SeedBlockedError(
        'Seed de DEMONSTRAÇÃO bloqueado: falta a confirmação explícita CONFIRM_DEMO_SEED=true. ' +
          'Ela não libera production nem host remoto — só confirma uma execução deliberada em desenvolvimento local.',
      );
    }
    return endpoint;
  }

  if ((isProduction(env) || endpoint.kind !== 'loopback') && env.ALLOW_PROD_SEED !== 'true') {
    const motivo = isProduction(env) ? 'NODE_ENV=production' : `DATABASE_URL aponta para endpoint não-loopback (${endpoint.host})`;
    throw new SeedBlockedError(
      `Seed ESTRUTURAL bloqueado: ${motivo}. Ele reconcilia perfis, permissões e planos reais; ` +
        'se a intenção é mesmo aplicar neste banco, rode com ALLOW_PROD_SEED=true dentro da governança de release.',
    );
  }
  return endpoint;
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
