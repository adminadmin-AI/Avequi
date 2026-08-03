import axios from 'axios';
import { singleFlight } from './single-flight';
import { tokensParaPersistir } from './session-tokens';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Cliente HTTP + renovação de sessão.
 *
 * O backend ROTACIONA o refresh token: cada `POST /auth/refresh` revoga o
 * token apresentado e devolve um par novo. Duas consequências que este
 * arquivo precisa respeitar — e que já custaram caro quando não respeitou:
 *
 * 1. **Guardar o refreshToken novo.** Guardar só o accessToken deixa no
 *    navegador um refresh já revogado; a renovação seguinte falha e o
 *    usuário vai parar no login. Como o access dura 15 min, isso derrubava
 *    a sessão a cada ~30 min, no meio do trabalho.
 * 2. **Renovar UMA vez por expiração.** Quando o access expira, todas as
 *    queries da tela levam 401 juntas. Sem single-flight, cada uma dispara
 *    um refresh: o primeiro rotaciona e os demais chegam com o token já
 *    revogado → 401 → logout. Quanto MAIS o sistema era usado, mais cedo
 *    ele derrubava.
 *
 * Não existe (e nunca existiu) logout por inatividade: o relógio é o do
 * `JWT_EXPIRY`, contado a partir da emissão. Expirar por ociosidade de
 * verdade seria regra nova — e de preferência no servidor.
 */

const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';

function lerToken(chave: string): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem(chave);
}

/** Grava o que veio na resposta; campo ausente não apaga o que já está lá. */
export function salvarSessao(data: unknown): void {
  if (typeof window === 'undefined') return;
  const { accessToken, refreshToken } = tokensParaPersistir(data as never);
  if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function limparSessao(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export const apiClient = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  const token = lerToken(ACCESS_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Renova a sessão. `singleFlight` garante que as N chamadas que tomaram 401
 * ao mesmo tempo compartilhem UMA renovação — a rotação do refresh não
 * perdoa concorrência.
 *
 * Usa axios "cru" de propósito: pelo apiClient, a própria renovação cairia
 * neste interceptor se respondesse 401.
 */
const renovarSessao = singleFlight(async (): Promise<boolean> => {
  const refreshToken = lerToken(REFRESH_KEY);
  if (!refreshToken) return false;
  try {
    const { data } = await axios.post(
      `${API_URL}/auth/refresh`,
      { refreshToken },
      { withCredentials: true },
    );
    // Os DOIS tokens — o antigo acabou de ser revogado pela rotação.
    salvarSessao(data);
    return true;
  } catch {
    return false;
  }
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // `_retry` impede laço: uma tentativa de renovação por requisição.
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;

      if (await renovarSessao()) {
        const novo = lerToken(ACCESS_KEY);
        if (novo) original.headers.Authorization = `Bearer ${novo}`;
        return apiClient.request(original);
      }

      limparSessao();
      if (typeof window !== 'undefined') window.location.href = '/login';
    }

    return Promise.reject(error);
  },
);
