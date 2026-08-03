import { describe, expect, it } from 'vitest';
import { canalDaSessao, ehErroDeCsrf, veredictoDaVerificacao } from './auth-session';

describe('canalDaSessao', () => {
  it('resposta com csrfToken → canal cookie', () => {
    expect(canalDaSessao({ csrfToken: 'abc', accessToken: 'AT', refreshToken: 'RT' })).toBe('cookie');
  });

  it('resposta SEM csrfToken → canal bearer (API anterior ao #349)', () => {
    // É o caso da janela de deploy com o web à frente da API: sem este
    // fallback o usuário loga e cai em 401 em toda chamada seguinte.
    expect(canalDaSessao({ accessToken: 'AT', refreshToken: 'RT' })).toBe('bearer');
  });

  it('resposta vazia/ausente não quebra e assume bearer', () => {
    expect(canalDaSessao({})).toBe('bearer');
    expect(canalDaSessao(null)).toBe('bearer');
    expect(canalDaSessao(undefined)).toBe('bearer');
  });
});

describe('ehErroDeCsrf', () => {
  it('403 com o header x-csrf-error é recuperável', () => {
    expect(ehErroDeCsrf({ response: { status: 403, headers: { 'x-csrf-error': '1' } } })).toBe(true);
  });

  it('403 sem header mas com CSRF na mensagem também (API na janela de deploy)', () => {
    expect(
      ehErroDeCsrf({
        response: { status: 403, headers: {}, data: { message: 'Requisição rejeitada pela proteção CSRF.' } },
      }),
    ).toBe(true);
  });

  it('403 de PERMISSÃO não é de CSRF — repetir mascararia erro de RBAC', () => {
    expect(
      ehErroDeCsrf({
        response: { status: 403, headers: {}, data: { message: 'Permissão negada: finance.entries.view' } },
      }),
    ).toBe(false);
  });

  it('outros status nunca contam', () => {
    expect(ehErroDeCsrf({ response: { status: 401, headers: { 'x-csrf-error': '1' } } })).toBe(false);
    expect(ehErroDeCsrf({ response: { status: 500 } })).toBe(false);
    expect(ehErroDeCsrf({})).toBe(false);
  });

  it('mensagem não-string (array do ValidationPipe) não quebra', () => {
    expect(ehErroDeCsrf({ response: { status: 403, headers: {}, data: { message: ['a', 'b'] } } })).toBe(
      false,
    );
  });
});

describe('veredictoDaVerificacao (paliativo do cookie de terceiros)', () => {
  it('verificação OK → o canal cookie autentica de verdade', () => {
    expect(veredictoDaVerificacao({ ok: true, temAccessToken: true })).toBe('cookie-funciona');
  });

  it('401 logo após login com token no body → resgata Bearer (caso Safari/ITP)', () => {
    expect(veredictoDaVerificacao({ ok: false, status: 401, temAccessToken: true })).toBe(
      'resgatar-bearer',
    );
  });

  it('401 sem token no body → indeterminado (não há o que resgatar)', () => {
    expect(veredictoDaVerificacao({ ok: false, status: 401, temAccessToken: false })).toBe(
      'indeterminado',
    );
  });

  it.each([500, 502, 403, undefined])(
    'status %s não conclui nada — soluço de rede não pode virar token no storage',
    (status) => {
      expect(veredictoDaVerificacao({ ok: false, status, temAccessToken: true })).toBe(
        'indeterminado',
      );
    },
  );
});
