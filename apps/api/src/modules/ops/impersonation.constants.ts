/**
 * Constantes da impersonation — OPS WP6 (#913).
 * Arquivo próprio (sem DI) para a JwtStrategy importar sem acoplar o módulo
 * auth ao módulo ops.
 */

/** Claim `scope` do token de impersonation — aceito como access token PELO
 *  JwtStrategy com contexto de impersonation anexado (≠ mfa_pending e
 *  password_change, que são rejeitados). */
export const IMPERSONATION_SCOPE = 'impersonation';

/** Vida do token: 30 minutos. Sem refresh — expirou, acabou a visita. */
export const IMPERSONATION_TTL = '30m';
export const IMPERSONATION_TTL_SECONDS = 30 * 60;
