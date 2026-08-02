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

/**
 * Veredicto da verificação pós-login do canal cookie.
 *
 * Por que verificar: quando front e API estão em SITES diferentes
 * (`avecchi.ai` × `up.railway.app`), `gdr_access` é um cookie de TERCEIROS —
 * e Safari bloqueia esses cookies por padrão (Firefox estrito isola, Chrome
 * está eliminando). Nesse caso a API responde `csrfToken` normalmente, o
 * front acredita no canal cookie... e nada autentica: o usuário loga e cai
 * em 401 em tudo, num laço de login. Não dá para detectar isso lendo o
 * cookie (é httpOnly): só perguntando ao servidor se ele nos reconhece.
 *
 * É paliativo. A correção real é a API sob o mesmo site do front
 * (`api.avecchi.ai`), quando o cookie vira first-party e nada disso importa.
 */
export type VeredictoCookie = 'cookie-funciona' | 'resgatar-bearer' | 'indeterminado';

export function veredictoDaVerificacao(params: {
  ok: boolean;
  status?: number;
  temAccessToken: boolean;
}): VeredictoCookie {
  if (params.ok) return 'cookie-funciona';
  // 401 logo após um login bem-sucedido = o cookie não foi guardado.
  if (params.status === 401) {
    return params.temAccessToken ? 'resgatar-bearer' : 'indeterminado';
  }
  // Rede fora, 500, timeout: não dá para concluir nada sobre o cookie —
  // trocar de canal aqui seria gravar token no storage por causa de um
  // soluço de rede, justamente o que o #349 quer evitar.
  return 'indeterminado';
}
