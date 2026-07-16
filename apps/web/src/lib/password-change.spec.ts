import { describe, expect, it } from 'vitest';
import { checkRouteAccess } from './nav-config';
import {
  PASSWORD_CHANGE_TOKEN_TTL_MS,
  PENDING_PASSWORD_CHANGE_KEY,
  clearPendingPasswordChange,
  readPendingPasswordChange,
  resolveChangePasswordError,
  storePendingPasswordChange,
  type KeyValueStorage,
} from './password-change';

/** sessionStorage em memória — mesmo contrato, sem jsdom. */
function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const pending = {
  passwordChangeToken: 'tok-restrito',
  email: 'teste@gdr.com.br',
  passwordExpired: false,
};

describe('handoff login → /change-password (#735)', () => {
  it('round-trip dentro do TTL devolve o registro', () => {
    const storage = memoryStorage();
    storePendingPasswordChange(storage, pending, 1_000);
    expect(readPendingPasswordChange(storage, 2_000)).toEqual(pending);
  });

  it('expirado (TTL de 10 min do token) → null e registro removido', () => {
    const storage = memoryStorage();
    storePendingPasswordChange(storage, pending, 1_000);
    const after = 1_000 + PASSWORD_CHANGE_TOKEN_TTL_MS + 1;
    expect(readPendingPasswordChange(storage, after)).toBeNull();
    expect(storage.getItem(PENDING_PASSWORD_CHANGE_KEY)).toBeNull();
  });

  it('registro corrompido → null sem lançar (e removido)', () => {
    const storage = memoryStorage();
    storage.setItem(PENDING_PASSWORD_CHANGE_KEY, '{nao-e-json');
    expect(readPendingPasswordChange(storage)).toBeNull();
    expect(storage.getItem(PENDING_PASSWORD_CHANGE_KEY)).toBeNull();
  });

  it('ausente → null; clear remove', () => {
    const storage = memoryStorage();
    expect(readPendingPasswordChange(storage)).toBeNull();
    storePendingPasswordChange(storage, pending);
    clearPendingPasswordChange(storage);
    expect(readPendingPasswordChange(storage)).toBeNull();
  });
});

describe('rota /app/account/password (#736) — autenticada, sem permissão de módulo', () => {
  /**
   * Contrato do RouteGuard travado por teste: a rota NÃO entra no NAV de
   * propósito (autoatendimento) → status "unmapped" = liberada para QUALQUER
   * perfil autenticado, sem gate de permissão/role. A autenticação em si vem
   * de fora do RouteGuard: o AppLayout redireciona não autenticado p/ /login
   * e o backend exige Bearer + senha atual no POST /auth/change-password.
   * Se alguém mapear a rota no NAV com permission/roles, este teste quebra
   * e a decisão precisa ser revisitada.
   */
  it('não é mapeada no NAV → RouteGuard libera p/ qualquer autenticado', () => {
    const semPermissoes = { role: 'READER', can: () => false };
    expect(checkRouteAccess('/app/account/password', semPermissoes)).toEqual({
      status: 'unmapped',
    });
  });
});

describe('resolveChangePasswordError — mensagens da política (#345) em PT-BR', () => {
  it('array de faltas da política vira lista em linhas', () => {
    const err = {
      response: {
        status: 400,
        data: { message: ['Falta letra maiúscula.', 'Falta caractere especial.'] },
      },
    };
    expect(resolveChangePasswordError(err)).toBe(
      'Falta letra maiúscula.\nFalta caractere especial.',
    );
  });

  it('message string do backend é exibida como veio', () => {
    const err = { response: { status: 401, data: { message: 'Senha atual incorreta.' } } };
    expect(resolveChangePasswordError(err)).toBe('Senha atual incorreta.');
  });

  it('401 sem message → credencial inválida/expirada', () => {
    expect(resolveChangePasswordError({ response: { status: 401 } })).toMatch(/expirada/);
  });

  it('429 do throttle (5/min) → orienta aguardar', () => {
    expect(resolveChangePasswordError({ response: { status: 429 } })).toMatch(/Aguarde/);
  });

  it('rede fora → servidor indisponível', () => {
    expect(resolveChangePasswordError({ code: 'ERR_NETWORK' })).toMatch(/indisponível/);
  });
});
