import { randomBytes } from 'crypto';
import { Response } from 'express';

/**
 * Cookies httpOnly de autenticação — #349 (decisão Rafael 01/08/2026:
 * migrar tokens do localStorage para cookie httpOnly + CSRF).
 *
 * MODO DUAL (transição sem quebra): o login/refresh CONTINUA devolvendo os
 * tokens no body — clientes Bearer existentes (web atual, scripts, Swagger)
 * seguem funcionando. Os cookies são um canal ADICIONAL; o front migra para
 * eles e o body poderá ser enxugado numa fase 2, quando nada mais consumir.
 *
 * Desenho dos cookies:
 * - `gdr_access`  (httpOnly): access JWT. Path /api — vai em toda chamada.
 * - `gdr_refresh` (httpOnly): refresh JWT. Path restrito a /api/auth — o
 *   token de longa vida só trafega nas rotas de auth (refresh/logout).
 * - `gdr_csrf`    (httpOnly): segredo do double-submit. O VALOR é devolvido
 *   no body (`csrfToken`) para o front ecoar no header `x-csrf-token` — o
 *   cookie é httpOnly de propósito: front e API vivem em SITES diferentes
 *   (vercel.app × railway.app) e document.cookie não leria um cookie
 *   cross-site de qualquer forma. Um atacante em outra origem não lê o body
 *   da resposta nem o cookie, então não forja o header.
 *
 * SameSite: depende da TOPOLOGIA, então é configuração, não constante.
 *
 * - `none` (default em produção): front e API em sites distintos. Funciona
 *   em qualquer topologia, inclusive na mesma — por isso é o default: quem
 *   esquecer de configurar não quebra nada.
 * - `lax`: front e API no MESMO site (hoje `app.avecchi.ai` × `api.avecchi.ai`).
 *   Mais restritivo, e imune ao bloqueio de cookies de TERCEIROS que Safari
 *   aplica por padrão — é o que faz a sessão por cookie funcionar no iPhone.
 *
 * Ligue com `AUTH_COOKIE_SAMESITE=lax` no ambiente. Deixei explícito de
 * propósito em vez de adivinhar comparando domínios: a heurística de
 * "mesmo site" erra feio em sufixos compostos (`.com.br`), e errar aqui
 * significa cookie que não vai — falha silenciosa e difícil de achar.
 */

export const ACCESS_COOKIE = 'gdr_access';
export const REFRESH_COOKIE = 'gdr_refresh';
export const CSRF_COOKIE = 'gdr_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Rotas de auth — único path que recebe o cookie de refresh. */
const AUTH_PATH = '/api/auth';

/** '15m' | '7d' | '60' (segundos) → milissegundos; inválido → fallback. */
export function expiryToMs(expiry: string | undefined, fallbackMs: number): number {
  if (!expiry) return fallbackMs;
  const m = /^(\d+)([smhdwy])?$/.exec(expiry.trim());
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const unit: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  return n * (m[2] ? unit[m[2]] : 1000);
}

/** 'lax' | 'none' — ver a nota de topologia no topo do arquivo. */
export function resolveSameSite(): 'lax' | 'none' {
  const prod = process.env.NODE_ENV === 'production';
  const configurado = process.env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase();
  if (configurado === 'lax' || configurado === 'none') return configurado;
  // Sem configuração: fora de produção é sempre mesmo host (localhost), então
  // lax; em produção mantém o comportamento que funciona em qualquer topologia.
  return prod ? 'none' : 'lax';
}

function baseOptions() {
  const prod = process.env.NODE_ENV === 'production';
  const sameSite = resolveSameSite();
  return {
    httpOnly: true,
    // SameSite=None EXIGE Secure; com lax, secure segue o ambiente.
    secure: prod || sameSite === 'none',
    sameSite,
  };
}

export function gerarCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Seta os 3 cookies após emissão de tokens (login, MFA verify, refresh,
 * troca de senha). Retorna o csrfToken para o controller incluir no body.
 */
export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken?: string },
): string {
  const opts = baseOptions();
  const accessMs = expiryToMs(process.env.JWT_EXPIRY, 15 * 60_000);
  const refreshMs = expiryToMs(process.env.JWT_REFRESH_EXPIRY, 7 * 86_400_000);

  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...opts, maxAge: accessMs });
  if (tokens.refreshToken) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...opts,
      path: AUTH_PATH,
      maxAge: refreshMs,
    });
  }
  // CSRF vive tanto quanto o refresh (sobrevive à renovação do access).
  const csrf = gerarCsrfToken();
  res.cookie(CSRF_COOKIE, csrf, { ...opts, maxAge: refreshMs });
  return csrf;
}

/** Limpa os 3 cookies (logout). Mesmos atributos do set — senão o browser ignora. */
/**
 * Fonte ÚNICA do access token de uma requisição — a mesma precedência da
 * JwtStrategy (#349): header `Authorization: Bearer <token>` (clientes
 * atuais/legados, Swagger, scripts) e, sem header, o cookie httpOnly
 * `gdr_access` (front migrado). Nunca lê `gdr_refresh`: refresh não é access.
 *
 * Quem precisa da identidade fora do guard global (rotas @Public que aceitam
 * DUAS credenciais, como POST /auth/change-password) usa ISTO — não parseia
 * header por conta própria, senão o canal cookie fica invisível e a rota
 * "funciona" só para Bearer (bug reproduzido em produção em 02/09/2026).
 */
export function extractAccessToken(
  req: { headers?: Record<string, unknown>; cookies?: Record<string, unknown> } | undefined,
): string | null {
  const header = req?.headers?.authorization;
  if (typeof header === 'string') {
    const m = /^bearer\s+(\S+)\s*$/i.exec(header);
    if (m) return m[1];
  }
  const cookie = req?.cookies?.[ACCESS_COOKIE];
  return typeof cookie === 'string' && cookie.length > 0 ? cookie : null;
}

export function clearAuthCookies(res: Response): void {
  const opts = baseOptions();
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: AUTH_PATH });
  res.clearCookie(CSRF_COOKIE, opts);
}
