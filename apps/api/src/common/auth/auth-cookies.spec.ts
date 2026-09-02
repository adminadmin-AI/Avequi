import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  expiryToMs,
  extractAccessToken,
  gerarCsrfToken,
  resolveSameSite,
  setAuthCookies,
} from './auth-cookies';

function resMock() {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as any;
}

describe('auth-cookies (#349)', () => {
  const OLD_ENV = process.env;
  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('expiryToMs', () => {
    it.each([
      ['15m', 15 * 60_000],
      ['7d', 7 * 86_400_000],
      ['1h', 3_600_000],
      ['45s', 45_000],
      ['60', 60_000], // sem unidade = segundos (convenção do jsonwebtoken)
    ])('%s → %d ms', (expiry, ms) => {
      expect(expiryToMs(expiry, 0)).toBe(ms);
    });

    it('valor ausente ou inválido cai no fallback', () => {
      expect(expiryToMs(undefined, 123)).toBe(123);
      expect(expiryToMs('abc', 456)).toBe(456);
    });
  });

  it('setAuthCookies seta access, refresh (path /api/auth) e csrf; devolve o csrf', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test', JWT_EXPIRY: '15m', JWT_REFRESH_EXPIRY: '7d' };
    const res = resMock();
    const csrf = setAuthCookies(res, { accessToken: 'AT', refreshToken: 'RT' });

    expect(csrf).toHaveLength(64); // 32 bytes hex
    const chamadas = Object.fromEntries(res.cookie.mock.calls.map((c: any[]) => [c[0], c]));
    expect(chamadas.gdr_access[1]).toBe('AT');
    expect(chamadas.gdr_access[2]).toMatchObject({ httpOnly: true, maxAge: 15 * 60_000 });
    expect(chamadas.gdr_refresh[1]).toBe('RT');
    expect(chamadas.gdr_refresh[2]).toMatchObject({
      httpOnly: true,
      path: '/api/auth',
      maxAge: 7 * 86_400_000,
    });
    expect(chamadas.gdr_csrf[1]).toBe(csrf);
    expect(chamadas.gdr_csrf[2]).toMatchObject({ httpOnly: true });
  });

  it('fora de produção: sem Secure, SameSite=lax; em produção: Secure + SameSite=none', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    let res = resMock();
    setAuthCookies(res, { accessToken: 'AT' });
    expect(res.cookie.mock.calls[0][2]).toMatchObject({ secure: false, sameSite: 'lax' });

    process.env = { ...OLD_ENV, NODE_ENV: 'production' };
    res = resMock();
    setAuthCookies(res, { accessToken: 'AT' });
    expect(res.cookie.mock.calls[0][2]).toMatchObject({ secure: true, sameSite: 'none' });
  });

  it('sem refreshToken não seta o cookie de refresh (ex.: fluxos que só renovam access)', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    const res = resMock();
    setAuthCookies(res, { accessToken: 'AT' });
    const nomes = res.cookie.mock.calls.map((c: any[]) => c[0]);
    expect(nomes).toEqual(['gdr_access', 'gdr_csrf']);
  });

  it('clearAuthCookies limpa os 3 com os mesmos atributos (refresh com path)', () => {
    process.env = { ...OLD_ENV, NODE_ENV: 'test' };
    const res = resMock();
    clearAuthCookies(res);
    const chamadas = Object.fromEntries(
      res.clearCookie.mock.calls.map((c: any[]) => [c[0], c[1]]),
    );
    expect(Object.keys(chamadas).sort()).toEqual(['gdr_access', 'gdr_csrf', 'gdr_refresh']);
    expect(chamadas.gdr_refresh).toMatchObject({ path: '/api/auth' });
  });

  it('gerarCsrfToken é aleatório e de 64 hex', () => {
    const a = gerarCsrfToken();
    const b = gerarCsrfToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe('SameSite por topologia (#349)', () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  it('produção sem configuração: none — funciona em qualquer topologia', () => {
    process.env = { ...OLD, NODE_ENV: 'production', AUTH_COOKIE_SAMESITE: undefined };
    expect(resolveSameSite()).toBe('none');
  });

  it('AUTH_COOKIE_SAMESITE=lax liga o modo mesmo-site (app.avecchi.ai × api.avecchi.ai)', () => {
    process.env = { ...OLD, NODE_ENV: 'production', AUTH_COOKIE_SAMESITE: 'lax' };
    expect(resolveSameSite()).toBe('lax');

    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as any;
    setAuthCookies(res, { accessToken: 'AT', refreshToken: 'RT' });
    // Secure continua ligado em produção, mesmo com lax.
    expect(res.cookie.mock.calls[0][2]).toMatchObject({ sameSite: 'lax', secure: true });
  });

  it('valor inválido cai no default do ambiente — nunca num sameSite inventado', () => {
    process.env = { ...OLD, NODE_ENV: 'production', AUTH_COOKIE_SAMESITE: 'strict' };
    expect(resolveSameSite()).toBe('none');
    process.env = { ...OLD, NODE_ENV: 'test', AUTH_COOKIE_SAMESITE: 'qualquer-coisa' };
    expect(resolveSameSite()).toBe('lax');
  });

  it('aceita a configuração com espaço/maiúsculas (copiar e colar de painel)', () => {
    process.env = { ...OLD, NODE_ENV: 'production', AUTH_COOKIE_SAMESITE: ' LAX ' };
    expect(resolveSameSite()).toBe('lax');
  });

  it('none FORÇA Secure mesmo fora de produção — o browser recusaria o cookie sem isso', () => {
    process.env = { ...OLD, NODE_ENV: 'test', AUTH_COOKIE_SAMESITE: 'none' };
    const res = { cookie: jest.fn(), clearCookie: jest.fn() } as any;
    setAuthCookies(res, { accessToken: 'AT' });
    expect(res.cookie.mock.calls[0][2]).toMatchObject({ sameSite: 'none', secure: true });
  });
});

/**
 * extractAccessToken — fonte única do access token (header Bearer OU cookie
 * httpOnly gdr_access), compartilhada pela JwtStrategy e pelo
 * POST /auth/change-password. Regressão do bug de 02/09/2026: a rota lia só o
 * header e a sessão por cookie caía em 401.
 */
describe('extractAccessToken (#349 — canal cookie e Bearer, uma fonte só)', () => {
  it('cookie gdr_access SEM header Authorization → devolve o token do cookie', () => {
    expect(extractAccessToken({ headers: {}, cookies: { [ACCESS_COOKIE]: 'tok-cookie' } })).toBe(
      'tok-cookie',
    );
  });

  it('header Bearer SEM cookie → devolve o token do header (clientes legados)', () => {
    expect(extractAccessToken({ headers: { authorization: 'Bearer tok-header' }, cookies: {} })).toBe(
      'tok-header',
    );
  });

  it('header e cookie presentes → header tem precedência (mesma regra da JwtStrategy)', () => {
    const req = {
      headers: { authorization: 'Bearer tok-header' },
      cookies: { [ACCESS_COOKIE]: 'tok-cookie' },
    };
    expect(extractAccessToken(req)).toBe('tok-header');
  });

  it('esquema é case-insensitive e tolera espaços extras (comportamento do passport)', () => {
    expect(extractAccessToken({ headers: { authorization: 'bearer   tok  ' } })).toBe('tok');
  });

  it('cookie gdr_refresh NUNCA é tratado como access', () => {
    expect(extractAccessToken({ headers: {}, cookies: { [REFRESH_COOKIE]: 'tok-refresh' } })).toBeNull();
  });

  it('header com esquema errado (Basic) ou vazio → null', () => {
    expect(extractAccessToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(extractAccessToken({ headers: { authorization: 'Bearer ' } })).toBeNull();
    expect(extractAccessToken({ headers: { authorization: 'Bearer' } })).toBeNull();
  });

  it('sem header, sem cookie, sem request → null', () => {
    expect(extractAccessToken({})).toBeNull();
    expect(extractAccessToken({ cookies: { [ACCESS_COOKIE]: '' } })).toBeNull();
    expect(extractAccessToken(undefined)).toBeNull();
  });
});
