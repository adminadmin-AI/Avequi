import axios from 'axios';
import { canalDaSessao, ehErroDeCsrf, veredictoDaVerificacao } from './auth-session';

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
 * apagados.
 *
 * BROWSER SEM SUPORTE A COOKIE DE TERCEIROS (Safari/ITP): a API responde
 * `csrfToken`, mas o browser descarta o cookie porque front e API estão em
 * sites diferentes. `confirmarCanalDeSessao` pergunta ao servidor logo após
 * o login se ele nos reconhece; se não, resgata o canal Bearer com os tokens
 * que vieram no body. Paliativo até a API viver em `api.avecchi.ai`.
 *
 * API SEM SUPORTE A COOKIE (ordem de deploy): se o web subir antes da API,
 * o login responde SEM `csrfToken` — sinal de que a API é anterior a esta
 * mudança. Nesse caso `registrarSessao` grava os tokens do body e a sessão
 * segue 100% Bearer, como antes. Sem esse fallback, o login "dá certo" e
 * toda chamada seguinte volta 401: o usuário fica preso num laço de login
 * enquanto durar a janela entre os dois deploys.
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

interface RespostaDeSessao {
  csrfToken?: string;
  accessToken?: string;
  refreshToken?: string;
}

/**
 * Registra a sessão emitida por login/mfa/refresh, escolhendo o canal pela
 * resposta do servidor:
 *
 * - com `csrfToken` → API já fala cookie: guarda só o segredo de CSRF e
 *   apaga qualquer token legado (a autenticação vai nos cookies httpOnly);
 * - sem `csrfToken` → API anterior ao #349: cai no canal Bearer, gravando os
 *   tokens do body como o cliente antigo fazia.
 *
 * Devolve o canal escolhido para quem quiser logar/telemetrar.
 */
export function registrarSessao(data: RespostaDeSessao): 'cookie' | 'bearer' {
  const canal = canalDaSessao(data);
  if (typeof window === 'undefined') return canal;

  if (canal === 'cookie') {
    salvarCsrfToken(data.csrfToken);
    localStorage.removeItem(LEGACY_ACCESS);
    localStorage.removeItem(LEGACY_REFRESH);
    return canal;
  }

  if (data?.accessToken) {
    localStorage.setItem(LEGACY_ACCESS, data.accessToken);
    if (data.refreshToken) localStorage.setItem(LEGACY_REFRESH, data.refreshToken);
  }
  return canal;
}

/**
 * Confirma, logo após o login, que o canal cookie realmente autentica —
 * uma chamada autenticada SEM Bearer. Se voltar 401, o cookie não foi
 * guardado pelo browser (bloqueio de terceiros) e a sessão é resgatada no
 * canal Bearer com os tokens do body.
 *
 * Usa `/auth/me/permissions` de propósito: é a primeira coisa que o app
 * pede depois de entrar, então na prática esta verificação não adiciona
 * requisição nenhuma ao caminho de login — só antecipa uma.
 *
 * axios "cru" (não o apiClient) para não passar pelos interceptores: o
 * retry/refresh automático mascararia justamente o 401 que queremos ver.
 */
export async function confirmarCanalDeSessao(data: RespostaDeSessao): Promise<'cookie' | 'bearer'> {
  if (typeof window === 'undefined') return 'cookie';
  const csrf = localStorage.getItem(CSRF_KEY);

  try {
    await axios.get(`${API_URL}/auth/me/permissions`, {
      withCredentials: true,
      headers: csrf ? { 'x-csrf-token': csrf } : undefined,
    });
    return 'cookie';
  } catch (error: any) {
    const veredicto = veredictoDaVerificacao({
      ok: false,
      status: error?.response?.status,
      temAccessToken: !!data?.accessToken,
    });
    if (veredicto !== 'resgatar-bearer') return 'cookie';

    localStorage.setItem(LEGACY_ACCESS, data.accessToken as string);
    if (data.refreshToken) localStorage.setItem(LEGACY_REFRESH, data.refreshToken);
    return 'bearer';
  }
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
    registrarSessao(data);
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

/**
 * Encerra a sessão no servidor para limpar os cookies httpOnly. É o único
 * jeito de sair de um estado em que o cookie de access ainda vale mas o
 * segredo de CSRF se perdeu — o cookie `gdr_csrf` é httpOnly e o navegador
 * do usuário não o alcança. O endpoint é @SkipCsrf() justamente por isto.
 */
async function encerrarSessaoNoServidor(): Promise<void> {
  try {
    await axios.post(`${API_URL}/auth/logout`, {}, { withCredentials: true });
  } catch {
    /* sair nunca pode falhar por causa do servidor */
  }
}

function irParaLogin() {
  limparCredenciaisLocais();
  window.location.href = '/login';
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
      irParaLogin();
    }

    // 403 de CSRF é recuperável: o segredo local ficou dessincronizado do
    // cookie (storage limpo, sessão renovada em outra aba, cookie mais novo).
    // Renovar reemite o par e a chamada segue. Se nem isso resolver, o único
    // caminho é apagar os cookies no servidor — senão o usuário fica preso:
    // com `gdr_access` válido, toda mutação daria 403 até ele expirar.
    if (ehErroDeCsrf(error) && original && !original._csrfRetry) {
      original._csrfRetry = true;
      if (await renovarSessao()) {
        const csrf = localStorage.getItem(CSRF_KEY);
        if (csrf) original.headers['x-csrf-token'] = csrf;
        return apiClient.request(original);
      }
      await encerrarSessaoNoServidor();
      irParaLogin();
    }

    return Promise.reject(error);
  },
);
