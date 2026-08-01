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
 * Cross-site: em produção SameSite=None + Secure (front Vercel × API
 * Railway são sites distintos); em dev (localhost:3000 → localhost:3001)
 * Lax + sem Secure. Se um dia front e API forem para o mesmo domínio
 * (app.avecchi.com.br × api.avecchi.com.br), trocar para Lax é aperto
 * adicional — nada aqui impede.
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

function baseOptions() {
  const prod = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? ('none' as const) : ('lax' as const),
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
export function clearAuthCookies(res: Response): void {
  const opts = baseOptions();
  res.clearCookie(ACCESS_COOKIE, opts);
  res.clearCookie(REFRESH_COOKIE, { ...opts, path: AUTH_PATH });
  res.clearCookie(CSRF_COOKIE, opts);
}
