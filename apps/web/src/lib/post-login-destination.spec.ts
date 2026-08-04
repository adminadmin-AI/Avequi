import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: (...args: unknown[]) => getMock(...args) },
}));

import { destinoPosLogin } from './post-login-destination';

describe('destinoPosLogin (OPS F2 + #735) — pouso por papel após login/troca de senha', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('qualquer permissão ops.* pousa no console da operadora', async () => {
    getMock.mockResolvedValue({ data: { permissions: ['sales.orders.view', 'ops.tenants.view'] } });
    await expect(destinoPosLogin()).resolves.toBe('/app/ops');
    expect(getMock).toHaveBeenCalledWith('/auth/me/permissions');
  });

  it('sem ops.* pousa no ERP do tenant', async () => {
    getMock.mockResolvedValue({ data: { permissions: ['sales.orders.view'] } });
    await expect(destinoPosLogin()).resolves.toBe('/app');
  });

  it('resposta sem permissions não quebra (fail-soft)', async () => {
    getMock.mockResolvedValue({ data: {} });
    await expect(destinoPosLogin()).resolves.toBe('/app');
  });

  it('falha na consulta cai no destino padrão (fail-soft)', async () => {
    getMock.mockRejectedValue(new Error('network'));
    await expect(destinoPosLogin()).resolves.toBe('/app');
  });
});
