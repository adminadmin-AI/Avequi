import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImpersonateResult } from '@/types/api';

/**
 * Suite roda em environment: 'node' (vitest.config.ts) — sem jsdom. Em vez
 * de puxar jsdom só para este arquivo, simulamos localStorage/window com
 * stubGlobal: mais barato e prova que o módulo é SSR-safe de verdade (usa
 * `typeof window` como o resto do repo, não assume DOM disponível).
 */

const postMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { post: (...args: unknown[]) => postMock(...args) },
}));

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const result: ImpersonateResult = {
  impersonationToken: 'target-token',
  expiresAt: '2026-08-03T12:30:00.000Z',
  iid: 'iid-1',
  target: { id: 'u1', name: 'Fulano', email: 'fulano@cliente.com', role: 'MANAGER' },
};

let assignMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  postMock.mockReset();
  assignMock = vi.fn();
  vi.stubGlobal('localStorage', makeLocalStorage());
  vi.stubGlobal('window', { location: { assign: assignMock } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('impersonation.start', () => {
  it('faz backup dos tokens do operador, troca accessToken, remove refreshToken e navega para /app', async () => {
    const impersonation = await import('./impersonation');
    localStorage.setItem('accessToken', 'op-access');
    localStorage.setItem('refreshToken', 'op-refresh');

    impersonation.start(result, 'tenant-1');

    expect(localStorage.getItem('accessToken')).toBe('target-token');
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(JSON.parse(localStorage.getItem('avequi:op-backup')!)).toEqual({
      accessToken: 'op-access',
      refreshToken: 'op-refresh',
    });
    expect(JSON.parse(localStorage.getItem('avequi:impersonation')!)).toEqual({
      iid: 'iid-1',
      tenantId: 'tenant-1',
      targetName: 'Fulano',
      targetEmail: 'fulano@cliente.com',
      expiresAt: result.expiresAt,
    });
    expect(assignMock).toHaveBeenCalledWith('/app');
  });

  it('faz backup mesmo quando o operador não tinha refreshToken salvo', async () => {
    const impersonation = await import('./impersonation');
    localStorage.setItem('accessToken', 'op-access');

    impersonation.start(result, 'tenant-1');

    expect(JSON.parse(localStorage.getItem('avequi:op-backup')!)).toEqual({
      accessToken: 'op-access',
      refreshToken: null,
    });
  });
});

describe('impersonation.isActive', () => {
  it('retorna null quando não há sessão', async () => {
    const impersonation = await import('./impersonation');
    expect(impersonation.isActive()).toBeNull();
  });

  it('retorna a sessão gravada por start()', async () => {
    const impersonation = await import('./impersonation');
    impersonation.start(result, 'tenant-1');
    expect(impersonation.isActive()).toEqual({
      iid: 'iid-1',
      tenantId: 'tenant-1',
      targetName: 'Fulano',
      targetEmail: 'fulano@cliente.com',
      expiresAt: result.expiresAt,
    });
  });

  it('não derruba com JSON corrompido — trata como sem sessão', async () => {
    const impersonation = await import('./impersonation');
    localStorage.setItem('avequi:impersonation', '{not-json');
    expect(impersonation.isActive()).toBeNull();
  });
});

describe('impersonation.endLocal', () => {
  it('restaura os tokens do operador, limpa as chaves e navega para /app/ops/<tenantId>', async () => {
    const impersonation = await import('./impersonation');
    localStorage.setItem('accessToken', 'op-access');
    localStorage.setItem('refreshToken', 'op-refresh');
    impersonation.start(result, 'tenant-1');

    impersonation.endLocal();

    expect(localStorage.getItem('accessToken')).toBe('op-access');
    expect(localStorage.getItem('refreshToken')).toBe('op-refresh');
    expect(localStorage.getItem('avequi:op-backup')).toBeNull();
    expect(localStorage.getItem('avequi:impersonation')).toBeNull();
    expect(assignMock).toHaveBeenCalledWith('/app/ops/tenant-1');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('sem sessão ativa, navega para /app/ops', async () => {
    const impersonation = await import('./impersonation');
    impersonation.endLocal();
    expect(assignMock).toHaveBeenCalledWith('/app/ops');
  });
});

describe('impersonation.end', () => {
  it('restaura os tokens ANTES do POST (o end precisa do token do operador)', async () => {
    const impersonation = await import('./impersonation');
    localStorage.setItem('accessToken', 'op-access');
    localStorage.setItem('refreshToken', 'op-refresh');
    impersonation.start(result, 'tenant-1');

    let accessTokenNoMomentoDoPost: string | null = null;
    postMock.mockImplementation(async () => {
      accessTokenNoMomentoDoPost = localStorage.getItem('accessToken');
      return { data: { ok: true } };
    });

    await impersonation.end();

    expect(accessTokenNoMomentoDoPost).toBe('op-access');
    expect(postMock).toHaveBeenCalledWith('/ops/tenants/tenant-1/impersonation/iid-1/end');
    expect(assignMock).toHaveBeenCalledWith('/app/ops/tenant-1');
  });

  it('segue e navega mesmo se o POST falhar (best-effort)', async () => {
    const impersonation = await import('./impersonation');
    impersonation.start(result, 'tenant-1');
    postMock.mockRejectedValue(new Error('network down'));

    await expect(impersonation.end()).resolves.toBeUndefined();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(assignMock).toHaveBeenCalledWith('/app/ops/tenant-1');
  });

  it('sem sessão ativa, não chama o backend e navega para /app/ops', async () => {
    const impersonation = await import('./impersonation');
    await impersonation.end();
    expect(postMock).not.toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith('/app/ops');
  });
});
