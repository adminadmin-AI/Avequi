/**
 * Guards dos seeds — Onda 0, higiene do seed IAM.
 *
 * Política FAIL-CLOSED, decidida por DOIS sinais: NODE_ENV e o DESTINO REAL
 * de DATABASE_URL (parseada antes de qualquer acesso ao banco).
 *
 * Destino LOCAL = só loopback explícito (localhost, 127.0.0.1, ::1). Qualquer
 * outro host é REMOTO — não importa o NODE_ENV. DATABASE_URL ausente, inválida
 * ou sem host determinável → bloqueia.
 *
 * - DEMO (empresas/usuários/catálogo fictícios): só com NODE_ENV ≠ production
 *   E destino local. Remoto bloqueia SEMPRE; não existe flag de override.
 *   `db:seed:demo` é recurso de banco local de desenvolvimento, e só.
 * - ESTRUTURAL / IAM (cClassTrib, perfis system, permissões, planos): local +
 *   não-production roda normalmente. NODE_ENV=production OU destino remoto
 *   exigem ALLOW_PROD_SEED=true exato — o nome ficou por compatibilidade, mas
 *   a flag passou a ser exigida também para qualquer banco remoto (inclusive
 *   um Postgres/Supabase "de desenvolvimento"), porque o seed reconcilia
 *   configuração real (perfis system, permissões, entitlements).
 *
 * Defesa em profundidade: mesmo com destino local, NODE_ENV=production mantém
 * o demo bloqueado e o estrutural exigindo a flag.
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
  DATABASE_URL?: string;
}

/** Domínios de e-mail das empresas reais — proibidos em qualquer dado demo. */
export const REAL_EMAIL_DOMAINS: ReadonlyArray<string> = ['gdr.com.br', 'crd.com.br'];

/** Trechos de nome que denunciam empresa real — proibidos em nome/razão social demo. */
export const REAL_COMPANY_MARKERS: ReadonlyArray<RegExp> = [/\bgdr\b/i, /\bcrd\b/i, /reboques?/i, /avecchi/i, /avequi/i];

/** Hosts considerados LOCAIS. Nada além de loopback explícito. */
export const LOCAL_DB_HOSTS: ReadonlyArray<string> = ['localhost', '127.0.0.1', '::1'];

const DB_SCHEMES = new Set(['postgres:', 'postgresql:']);

export class SeedBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedBlockedError';
  }
}

export interface DatabaseTarget {
  kind: 'local' | 'remote';
  host: string;
}

/**
 * Determina o destino efetivo de DATABASE_URL. Lança SeedBlockedError quando
 * a URL está ausente, não é postgres://, não parseia ou não tem host — nesses
 * casos o destino é indeterminável e o seed não pode prosseguir.
 * A mensagem nunca ecoa a URL (pode conter credencial): só o host.
 */
export function resolveDatabaseTarget(databaseUrl: string | undefined): DatabaseTarget {
  if (!databaseUrl || !databaseUrl.trim()) {
    throw new SeedBlockedError('Seed bloqueado: DATABASE_URL ausente — o destino do banco precisa ser conhecido antes de qualquer seed.');
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl.trim());
  } catch {
    throw new SeedBlockedError('Seed bloqueado: DATABASE_URL inválida (não parseável) — destino do banco indeterminável.');
  }
  if (!DB_SCHEMES.has(parsed.protocol)) {
    throw new SeedBlockedError(
      `Seed bloqueado: DATABASE_URL com esquema "${parsed.protocol}" não suportado (esperado postgres:// ou postgresql://).`,
    );
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new SeedBlockedError('Seed bloqueado: DATABASE_URL sem host — destino do banco indeterminável.');
  }
  return { kind: LOCAL_DB_HOSTS.includes(host) ? 'local' : 'remote', host };
}

function isProduction(env: SeedEnv): boolean {
  return env.NODE_ENV === 'production';
}

/**
 * Decide se um seed pode rodar contra este ambiente + destino. Lança
 * SeedBlockedError antes de qualquer acesso ao banco.
 */
export function assertSeedAllowed(kind: SeedKind, env: SeedEnv = process.env): DatabaseTarget {
  const target = resolveDatabaseTarget(env.DATABASE_URL);
  const prod = isProduction(env);

  if (kind === 'demo') {
    if (prod) {
      throw new SeedBlockedError(
        'Seed de DEMONSTRAÇÃO bloqueado em produção (NODE_ENV=production). Não existe flag de liberação: ' +
          'dados fictícios nunca entram em produção. Administrador real nasce pelo convite de tenant, não por seed.',
      );
    }
    if (target.kind !== 'local') {
      throw new SeedBlockedError(
        `Seed de DEMONSTRAÇÃO bloqueado: DATABASE_URL aponta para banco REMOTO (${target.host}). ` +
          'O demo só roda contra loopback (localhost / 127.0.0.1 / ::1); não existe flag de liberação para remoto.',
      );
    }
    return target;
  }

  if ((prod || target.kind !== 'local') && env.ALLOW_PROD_SEED !== 'true') {
    const motivo = prod ? 'NODE_ENV=production' : `DATABASE_URL aponta para banco REMOTO (${target.host})`;
    throw new SeedBlockedError(
      `Seed ESTRUTURAL bloqueado: ${motivo}. Ele reconcilia perfis, permissões e planos reais; ` +
        'se a intenção é mesmo aplicar neste banco, rode com ALLOW_PROD_SEED=true dentro da governança de release.',
    );
  }
  return target;
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
