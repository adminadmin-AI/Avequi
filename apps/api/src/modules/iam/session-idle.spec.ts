import { SessionRevokedReason } from '@prisma/client';
import { SessionService, resolveIdleTimeoutMs, SESSION_IDLE_TIMEOUT_MS, ACTIVITY_DEBOUNCE_MS } from './session.service';

/**
 * Expiração por INATIVIDADE (#341).
 *
 * Antes disto o `lastActivityAt` só mudava na rotação do refresh — ninguém
 * media atividade de verdade, e a percepção era de que o sistema deslogava
 * "por tempo", ignorando o uso. Aqui a sessão morre depois de N minutos SEM
 * NENHUMA requisição, e cada requisição empurra o relógio para frente.
 */
describe('resolveIdleTimeoutMs', () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  it('default de 15 minutos', () => {
    process.env = { ...OLD, SESSION_IDLE_TIMEOUT_MINUTES: undefined };
    expect(resolveIdleTimeoutMs()).toBe(15 * 60 * 1000);
  });

  it('respeita o valor configurado', () => {
    process.env = { ...OLD, SESSION_IDLE_TIMEOUT_MINUTES: '60' };
    expect(resolveIdleTimeoutMs()).toBe(60 * 60 * 1000);
  });

  it.each(['0', '-5', '5000', 'abc', ''])('valor inválido (%s) cai no default', (v) => {
    process.env = { ...OLD, SESSION_IDLE_TIMEOUT_MINUTES: v };
    expect(resolveIdleTimeoutMs()).toBe(15 * 60 * 1000);
  });

  it('o heartbeat é bem mais curto que o timeout — senão a medição fica grosseira', () => {
    expect(ACTIVITY_DEBOUNCE_MS).toBeLessThanOrEqual(SESSION_IDLE_TIMEOUT_MS / 4);
    expect(ACTIVITY_DEBOUNCE_MS).toBeGreaterThanOrEqual(30 * 1000);
  });
});

describe('SessionService.isSessionAliveAndTouch', () => {
  const prisma = {
    userSession: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshToken: { updateMany: jest.fn(), update: jest.fn() },
  };
  const service = new SessionService(prisma as any, { denySession: jest.fn() } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.userSession.update.mockResolvedValue({});
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.update.mockResolvedValue({});
  });

  it('sessão ativa: a requisição empurra o relógio da ociosidade', async () => {
    prisma.userSession.updateMany.mockResolvedValue({ count: 1 });

    expect(await service.isSessionAliveAndTouch('s1')).toBe(true);

    const where = prisma.userSession.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 's1', revokedAt: null });
    // só renova quem AINDA está dentro da janela — ociosa não "revive"
    expect(where.lastActivityAt.gte).toBeInstanceOf(Date);
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('ociosa além do limite: revoga como EXPIRED e nega', async () => {
    prisma.userSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      revokedAt: null,
      lastActivityAt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS - 60_000),
      refreshTokenId: 'r1',
    });

    expect(await service.isSessionAliveAndTouch('s1')).toBe(false);
    expect(prisma.userSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedReason: SessionRevokedReason.EXPIRED }),
      }),
    );
  });

  it('já revogada: nega sem revogar de novo', async () => {
    prisma.userSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      revokedAt: new Date(),
      lastActivityAt: new Date(),
      refreshTokenId: 'r1',
    });

    expect(await service.isSessionAliveAndTouch('s1')).toBe(false);
    expect(prisma.userSession.update).not.toHaveBeenCalled();
  });

  it('token legado sem sessão persistida continua valendo (#342)', async () => {
    prisma.userSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.userSession.findUnique.mockResolvedValue(null);

    expect(await service.isSessionAliveAndTouch('inexistente')).toBe(true);
  });

  it('dentro do debounce: apenas LÊ, não grava (evita UPDATE por requisição)', async () => {
    prisma.userSession.findUnique.mockResolvedValue({
      id: 's1',
      revokedAt: null,
      lastActivityAt: new Date(),
      refreshTokenId: null,
    });

    expect(await service.isSessionAliveAndTouch('s1', true)).toBe(true);
    expect(prisma.userSession.updateMany).not.toHaveBeenCalled();
  });

  it('banco fora do ar: FAIL-OPEN — instabilidade não desloga a fábrica', async () => {
    prisma.userSession.updateMany.mockRejectedValue(new Error('connection reset'));

    expect(await service.isSessionAliveAndTouch('s1')).toBe(true);
  });
});
