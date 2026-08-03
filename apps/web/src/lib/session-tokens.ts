/**
 * Persistência da sessão — regras puras (sem window, sem axios), testáveis.
 *
 * Existe por causa de um bug que derrubava todo mundo a cada ~30 minutos: o
 * interceptor renovava a sessão e guardava SÓ o `accessToken`, jogando fora o
 * `refreshToken` novo. Como o backend ROTACIONA (revoga o antigo a cada
 * renovação), o token que sobrava no navegador já estava morto — e a
 * renovação seguinte caía em 401, limpava tudo e mandava para o login.
 *
 * A regra aqui é simples e a spec existe para não deixar ninguém "otimizar"
 * o refreshToken para fora de novo.
 */

export interface RespostaDeTokens {
  accessToken?: unknown;
  refreshToken?: unknown;
}

export interface TokensPersistiveis {
  accessToken?: string;
  refreshToken?: string;
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor : undefined;
}

/**
 * O que deve ir para o storage a partir de uma resposta de login/refresh.
 * Campo ausente ou vazio é ignorado — nunca sobrescreve o que já existe com
 * lixo (a string "undefined" no storage já causou o #735).
 */
export function tokensParaPersistir(data: RespostaDeTokens | null | undefined): TokensPersistiveis {
  const out: TokensPersistiveis = {};
  const access = texto(data?.accessToken);
  const refresh = texto(data?.refreshToken);
  if (access) out.accessToken = access;
  if (refresh) out.refreshToken = refresh;
  return out;
}
