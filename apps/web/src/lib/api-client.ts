import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * #349 — autenticação por cookie httpOnly + CSRF (double-submit).
 *
 * Os tokens NÃO ficam mais no localStorage: o backend seta cookies httpOnly
 * (gdr_access/gdr_refresh) no login/refresh e o browser os envia sozinho
 * (withCredentials). O que o front guarda é só o csrfToken (devolvido no
 * body do login/refresh) — ele não autentica nada sozinho; serve para ecoar
 * no header x-csrf-token e provar que a mutação veio da nossa origem.
 *
 * TRANSIÇÃO: sessões abertas antes do deploy ainda têm tokens legados no
 * localStorage e nenhum cookie. Elas continuam funcionando (Bearer segue
 * aceito); no primeiro 401 o refresh legado roda e o servidor JÁ seta os
 * cookies na resposta — a sessão migra sozinha e os tokens legados são
 * apagados. Novos logins nunca mais escrevem tokens no localStorage.
 */

const CSRF_KEY = 'csrfToken';
const LEGACY_ACCESS = 'accessToken';
const LEGACY_REFRESH = 'refreshToken';

export function salvarCsrfToken(token: string | undefined) {
  if (typeof window === 'undefined' || !token) return;
  localStorage.setItem(CSRF_KEY, token);
}

export function limparCredenciaisLocais() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CSRF_KEY);
  localStorage.removeItem(LEGACY_ACCESS);
  localStorage.removeItem(LEGACY_REFRESH);
}

export const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // CSRF: ecoa o segredo da sessão (só a nossa origem o conhece).
    const csrf = localStorage.getItem(CSRF_KEY);
    if (csrf) config.headers['x-csrf-token'] = csrf;
    // Transição: sessão legada (pré-cookie) segue autenticando por Bearer.
    const legado = localStorage.getItem(LEGACY_ACCESS);
    if (legado) config.headers.Authorization = `Bearer ${legado}`;
  }
  return config;
});

/** Renova a sessão: cookie primeiro; sem cookie, tenta o refresh legado. */
async function renovarSessao(): Promise<boolean> {
  const tentar = async (body: Record<string, string>) => {
    const { data } = await axios.post(`${API_URL}/auth/refresh`, body, {
      withCredentials: true,
    });
    // Servidor setou cookies novos; daqui em diante a sessão é 100% cookie.
    salvarCsrfToken(data.csrfToken);
    localStorage.removeItem(LEGACY_ACCESS);
    localStorage.removeItem(LEGACY_REFRESH);
    return true;
  };

  try {
    return await tentar({});
  } catch {
    const legado = typeof window !== 'undefined' ? localStorage.getItem(LEGACY_REFRESH) : null;
    if (!legado) return false;
    try {
      return await tentar({ refreshToken: legado });
    } catch {
      return false;
    }
  }
}

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      if (await renovarSessao()) {
        // A renovação migrou a sessão p/ cookie: refazer SEM o Bearer velho
        // (o interceptor de request não vai reinjetá-lo — o legado foi limpo).
        delete original.headers?.Authorization;
        const csrf = localStorage.getItem(CSRF_KEY);
        if (csrf) original.headers['x-csrf-token'] = csrf;
        return apiClient.request(original);
      }
      limparCredenciaisLocais();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
