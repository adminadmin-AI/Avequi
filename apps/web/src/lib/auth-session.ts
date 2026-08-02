/**
 * Decisões puras da sessão (#349) — sem React, sem window, sem axios: dá para
 * testar em node e é onde mora a regra que evita os dois modos de falha do
 * canal por cookie.
 */

/** Canal de autenticação em uso após um login/refresh. */
export type CanalSessao = 'cookie' | 'bearer';

interface RespostaDeSessao {
  csrfToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * `csrfToken` na resposta é a prova de que a API já fala o canal cookie
 * (só o código do #349 o emite). Sem ele, a API é anterior — e insistir em
 * cookie deixaria o usuário logado sem credencial nenhuma: o login "dá
 * certo" e toda chamada seguinte volta 401, num laço até o deploy da API.
 */
export function canalDaSessao(data: RespostaDeSessao | null | undefined): CanalSessao {
  return data?.csrfToken ? 'cookie' : 'bearer';
}

/** Header que o CsrfGuard marca num 403 recuperável (ver csrf.guard.ts). */
export const CSRF_ERROR_HEADER = 'x-csrf-error';

/**
 * Distingue "403 de CSRF" (recuperável: renova a sessão e repete) de "403 de
 * permissão" (definitivo — repetir não adianta e mascararia um erro de RBAC).
 *
 * O header é o sinal confiável; a mensagem é o fallback para a janela em que
 * a API ainda não o marca.
 */
export function ehErroDeCsrf(error: {
  response?: { status?: number; headers?: Record<string, unknown>; data?: { message?: unknown } };
}): boolean {
  const res = error?.response;
  if (res?.status !== 403) return false;
  if (res.headers?.[CSRF_ERROR_HEADER]) return true;
  const msg = res.data?.message;
  return typeof msg === 'string' && msg.toUpperCase().includes('CSRF');
}
