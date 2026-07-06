import { AsyncLocalStorage } from 'async_hooks';

/**
 * Contexto de tenant por request, baseado em AsyncLocalStorage.
 *
 * É populado pelo TenantContextInterceptor (global, roda DEPOIS dos guards,
 * quando req.user já existe) e consumido pelo PrismaService/rls.extension
 * para propagar `app.current_company_id` ao PostgreSQL via `set_config()`
 * dentro de transações — o único mecanismo confiável com o pooler do
 * Supabase em transaction mode (porta 6543).
 */
export interface TenantContext {
  companyId?: string;
  /**
   * true enquanto uma transação Prisma está aberta neste fluxo assíncrono.
   * Evita que a extensão RLS tente abrir uma transação aninhada (com
   * connection_limit=1 no pooler isso causaria deadlock/timeout).
   */
  insidePrismaTransaction?: boolean;
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** Retorna o companyId do tenant atual, se houver contexto ativo. */
export function getTenantCompanyId(): string | undefined {
  return tenantStorage.getStore()?.companyId;
}

/** true se o fluxo assíncrono atual já está dentro de uma transação Prisma. */
export function isInsidePrismaTransaction(): boolean {
  return tenantStorage.getStore()?.insidePrismaTransaction === true;
}

/**
 * Executa `fn` com o tenant informado no contexto assíncrono.
 * Usado pelo TenantContextInterceptor (HTTP) e por jobs/listeners que
 * precisem definir o tenant manualmente fora de um request.
 */
export function runWithTenant<T>(companyId: string, fn: () => T): T {
  const current = tenantStorage.getStore();
  return tenantStorage.run({ ...current, companyId }, fn);
}

/**
 * Executa `fn` sinalizando que uma transação Prisma está aberta,
 * preservando o tenant atual. Uso interno do PrismaService.
 */
export function runInsidePrismaTransaction<T>(fn: () => T): T {
  const current = tenantStorage.getStore();
  return tenantStorage.run({ ...current, insidePrismaTransaction: true }, fn);
}
