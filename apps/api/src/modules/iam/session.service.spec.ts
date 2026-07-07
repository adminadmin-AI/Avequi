import { HttpException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionDenylistService } from './session-denylist.service';
import {
  LOCKOUT_LADDER_MINUTES,
  LOCKOUT_THRESHOLD,
  MAX_CONCURRENT_SESSIONS,
  SESSION_IDLE_TIMEOUT_MS,
  SessionService,
} from './session.service';

/**
 * Testes do SessionService (#342) — sessões, dispositivos e lockout.
 * PrismaService mockado (convenção do projeto: nunca banco real).
 */

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  loginAttempt: { create: jest.fn(), findMany: jest.fn() },
  userSession: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  trustedDevice: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  securityEvent: { create: jest.fn() },
  refreshToken: { updateMany: jest.fn() },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const mockDenylist = {
  deny: jest.fn(),
  isSessionDenylisted: jest.fn(),
};

/** Gera N falhas consecutivas recentes (mais nova primeiro). */
function failures(count: number, spacingMs = 1000): any[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    success: false,
    failReason: 'WRONG_PASSWORD',
    createdAt: new Date(now - i * spacingMs),
  }));
}

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SessionDenylistService, useValue: mockDenylist },
      ],
    }).compile();

    service = module.get(SessionService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
    mockPrisma.loginAttempt.create.mockResolvedValue({});
    mockPrisma.securityEvent.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});
  });

  // ─── Lockout ───────────────────────────────────────────────────────────────

  describe('lockout', () => {
    it('registra LoginAttempt em toda tentativa (sucesso e falha)', async () => {
      mockPrisma.loginAttempt.findMany.mockResolvedValue([]);

      await service.recordLoginAttempt('a@b.c', { ipAddress: '1.2.3.4', userAgent: 'UA' }, true);
      await service.recordLoginAttempt('a@b.c', {}, false, 'WRONG_PASSWORD' as any);

      expect(mockPrisma.loginAttempt.create).toHaveBeenNthCalledWith(1, {
        data: {
          email: 'a@b.c',
          ipAddress: '1.2.3.4',
          userAgent: 'UA',
          success: true,
          failReason: null,
        },
      });
      expect(mockPrisma.loginAttempt.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({ success: false, failReason: 'WRONG_PASSWORD' }),
      });
    });

    it(`trava a conta na ${LOCKOUT_THRESHOLD}ª falha consecutiva dentro de 15min (30min, nível 0)`, async () => {
      mockPrisma.loginAttempt.findMany.mockResolvedValue(failures(LOCKOUT_THRESHOLD));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'c1' });

      const before = Date.now();
      await service.recordLoginAttempt('a@b.c', {}, false, 'WRONG_PASSWORD' as any);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: { lockedUntil: expect.any(Date) },
        }),
      );
      const lockedUntil: Date = mockPrisma.user.update.mock.calls[0][0].data.lockedUntil;
      const minutes = (lockedUntil.getTime() - before) / 60000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThan(31);
      // SecurityEvent(LOCKOUT) gravado na mesma transação (Decisão 5)
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'LOCKOUT', severity: 'WARNING' }),
        }),
      );
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('escala o bloqueio: 15 falhas → 2h (nível 2) com severidade CRITICAL', async () => {
      mockPrisma.loginAttempt.findMany.mockResolvedValue(failures(LOCKOUT_THRESHOLD * 3));
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'c1' });

      const before = Date.now();
      await service.recordLoginAttempt('a@b.c', {}, false, 'WRONG_PASSWORD' as any);

      const lockedUntil: Date = mockPrisma.user.update.mock.calls[0][0].data.lockedUntil;
      const minutes = (lockedUntil.getTime() - before) / 60000;
      expect(Math.round(minutes)).toBe(LOCKOUT_LADDER_MINUTES[2]); // 120
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ severity: 'CRITICAL' }),
        }),
      );
    });

    it('NÃO trava quando as 5 falhas estão fora da janela de 15min', async () => {
      // 5 falhas espaçadas 10min cada → janela de 40min
      mockPrisma.loginAttempt.findMany.mockResolvedValue(
        failures(LOCKOUT_THRESHOLD, 10 * 60 * 1000),
      );
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'c1' });

      await service.recordLoginAttempt('a@b.c', {}, false, 'WRONG_PASSWORD' as any);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('sucesso quebra o streak: falhas antigas atrás de um sucesso não contam', async () => {
      const now = Date.now();
      mockPrisma.loginAttempt.findMany.mockResolvedValue([
        { success: false, createdAt: new Date(now) },
        { success: true, createdAt: new Date(now - 1000) }, // ← quebra aqui
        ...failures(10, 1000).map((f) => ({ ...f, createdAt: new Date(now - 2000) })),
      ]);
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'c1' });

      await service.recordLoginAttempt('a@b.c', {}, false, 'WRONG_PASSWORD' as any);

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('assertNotLocked lança 423 para conta com lockedUntil no futuro', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        lockedUntil: new Date(Date.now() + 10 * 60000),
      });

      await expect(service.assertNotLocked('a@b.c')).rejects.toMatchObject({
        status: 423,
      });
      // tentativa barrada registrada com motivo LOCKED
      expect(mockPrisma.loginAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ success: false, failReason: 'LOCKED' }),
      });
    });

    it('assertNotLocked deixa passar quando lockedUntil já expirou', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        lockedUntil: new Date(Date.now() - 1000),
      });

      await expect(service.assertNotLocked('a@b.c')).resolves.toBeUndefined();
    });

    it('anti-enumeração: e-mail INEXISTENTE hammerado também recebe o MESMO 423', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null); // conta não existe
      mockPrisma.loginAttempt.findMany.mockResolvedValue(failures(LOCKOUT_THRESHOLD));

      await expect(service.assertNotLocked('ghost@b.c')).rejects.toMatchObject({ status: 423 });
    });

    it('failsafe: erro de banco na consulta de lockout NÃO derruba o login (fail-open)', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('db down'));

      await expect(service.assertNotLocked('a@b.c')).resolves.toBeUndefined();
    });

    it('failsafe: erro ao gravar LoginAttempt não propaga', async () => {
      mockPrisma.loginAttempt.create.mockRejectedValue(new Error('db down'));

      await expect(
        service.recordLoginAttempt('a@b.c', {}, false, 'WRONG_PASSWORD' as any),
      ).resolves.toBeUndefined();
    });

    it('clearLockout zera lockedUntil (sucesso zera contador)', async () => {
      await service.clearLockout('u1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lockedUntil: null },
      });
    });

    it('unlockUser destrava e grava SecurityEvent(ACCOUNT_UNLOCKED)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', companyId: 'c1' });

      await service.unlockUser('u1', 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lockedUntil: null },
      });
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'ACCOUNT_UNLOCKED' }),
        }),
      );
    });
  });

  // ─── Sessões ───────────────────────────────────────────────────────────────

  describe('sessões', () => {
    const user = { id: 'u1', companyId: 'c1' };

    beforeEach(() => {
      mockPrisma.userSession.findMany.mockResolvedValue([]);
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({ id: 'dev-1', userId: 'u1' });
      mockPrisma.trustedDevice.update.mockResolvedValue({});
      mockPrisma.userSession.create.mockResolvedValue({ id: 'sess-1' });
      mockPrisma.userSession.update.mockResolvedValue({});
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.userSession.updateMany.mockResolvedValue({ count: 1 });
    });

    it('cria sessão no login com IP, user-agent, fingerprint e vínculo ao refresh', async () => {
      const session = await service.createSession(
        user,
        { ipAddress: '10.0.0.1', userAgent: 'Edge/120' },
        'rt-1',
      );

      expect(session).toEqual({ id: 'sess-1' });
      expect(mockPrisma.userSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          companyId: 'c1',
          refreshTokenId: 'rt-1',
          ipAddress: '10.0.0.1',
          userAgent: 'Edge/120',
          deviceFingerprint: expect.stringMatching(/^[0-9a-f]{32}$/),
        }),
      });
    });

    it(`derruba a sessão mais antiga ao estourar o limite de ${MAX_CONCURRENT_SESSIONS}`, async () => {
      mockPrisma.userSession.findMany.mockResolvedValue(
        Array.from({ length: MAX_CONCURRENT_SESSIONS }, (_, i) => ({
          id: `old-${i}`,
          refreshTokenId: `rt-old-${i}`,
        })),
      );

      await service.createSession(user, {}, 'rt-new');

      // old-0 (mais antiga por lastActivityAt asc) revogada com EXPIRED
      expect(mockPrisma.userSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-0' },
          data: expect.objectContaining({ revokedReason: 'EXPIRED' }),
        }),
      );
      // e o refresh token dela morreu junto
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'rt-old-0' }) }),
      );
      expect(mockPrisma.userSession.create).toHaveBeenCalled();
    });

    it('device novo gera TrustedDevice + SecurityEvent(NEW_DEVICE, WARNING)', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue(null);
      mockPrisma.trustedDevice.create.mockResolvedValue({});

      await service.createSession(user, { userAgent: 'Novo Device' }, 'rt-1');

      expect(mockPrisma.trustedDevice.create).toHaveBeenCalled();
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'NEW_DEVICE', severity: 'WARNING' }),
        }),
      );
    });

    it('device conhecido só atualiza lastSeenAt (sem evento)', async () => {
      await service.createSession(user, { userAgent: 'Conhecido' }, 'rt-1');

      expect(mockPrisma.trustedDevice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { lastSeenAt: expect.any(Date) } }),
      );
      expect(mockPrisma.securityEvent.create).not.toHaveBeenCalled();
    });

    it('failsafe: erro de banco na criação devolve null (login segue sem sessionId)', async () => {
      mockPrisma.userSession.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.createSession(user, {}, 'rt-1')).resolves.toBeNull();
    });

    it('validateSessionForRefresh: refresh legado sem sessão é aceito (transição M4)', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue(null);

      await expect(service.validateSessionForRefresh('rt-legacy')).resolves.toEqual({
        active: true,
        session: null,
      });
    });

    it('validateSessionForRefresh: sessão revogada nega o refresh', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        lastActivityAt: new Date(),
        revokedAt: new Date(),
      });

      await expect(service.validateSessionForRefresh('rt-1')).resolves.toEqual({
        active: false,
        session: null,
      });
    });

    it('validateSessionForRefresh: inatividade > 60min expira a sessão e nega', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        lastActivityAt: new Date(Date.now() - SESSION_IDLE_TIMEOUT_MS - 60000),
        revokedAt: null,
      });

      const result = await service.validateSessionForRefresh('rt-1');

      expect(result.active).toBe(false);
      expect(mockPrisma.userSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({ revokedReason: 'EXPIRED' }),
        }),
      );
    });

    it('validateSessionForRefresh: sessão ativa mantém o refresh', async () => {
      const lastActivityAt = new Date();
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        lastActivityAt,
        revokedAt: null,
      });

      await expect(service.validateSessionForRefresh('rt-1')).resolves.toEqual({
        active: true,
        session: { id: 'sess-1', lastActivityAt },
      });
    });

    it('attachRefreshToSession reamarra o novo refresh à MESMA sessão', async () => {
      await service.attachRefreshToSession('sess-1', 'rt-2');

      expect(mockPrisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { refreshTokenId: 'rt-2', lastActivityAt: expect.any(Date) },
      });
    });

    it('listSessions devolve só sessões ativas do usuário', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([{ id: 'sess-1' }]);

      const result = await service.listSessions('u1');

      expect(result).toEqual([{ id: 'sess-1' }]);
      expect(mockPrisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
      );
    });
  });

  // ─── Revogação e denylist ──────────────────────────────────────────────────

  describe('revogação e denylist', () => {
    beforeEach(() => {
      mockPrisma.userSession.update.mockResolvedValue({});
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    });

    it('revokeSession revoga sessão + refresh token e grava SecurityEvent', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        userId: 'u1',
        companyId: 'c1',
        refreshTokenId: 'rt-1',
        revokedAt: null,
      });

      await service.revokeSession('sess-1', 'LOGOUT' as any, 'u1');

      expect(mockPrisma.userSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({ revokedAt: expect.any(Date), revokedReason: 'LOGOUT' }),
        }),
      );
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventType: 'SESSION_REVOKED' }),
        }),
      );
      // LOGOUT não é crítico → NÃO entra na denylist
      expect(mockDenylist.deny).not.toHaveBeenCalled();
    });

    it('revogação crítica (ADMIN_REVOKE) coloca o sessionId na denylist Redis', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        userId: 'u2',
        companyId: 'c1',
        refreshTokenId: 'rt-1',
        revokedAt: null,
      });

      await service.revokeSession('sess-1', 'ADMIN_REVOKE' as any);

      expect(mockDenylist.deny).toHaveBeenCalledWith('sess-1');
    });

    it('anti-IDOR: revogar sessão de OUTRO usuário com expectedUserId → 404', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        userId: 'dono-verdadeiro',
        companyId: 'c1',
        refreshTokenId: 'rt-1',
        revokedAt: null,
      });

      await expect(service.revokeSession('sess-1', 'LOGOUT' as any, 'invasor')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.userSession.update).not.toHaveBeenCalled();
    });

    it('revokeSession é idempotente para sessão já revogada', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-1',
        userId: 'u1',
        companyId: 'c1',
        refreshTokenId: 'rt-1',
        revokedAt: new Date(),
      });

      await service.revokeSession('sess-1', 'LOGOUT' as any, 'u1');

      expect(mockPrisma.userSession.update).not.toHaveBeenCalled();
    });

    it('revokeAllSessions revoga todas as ativas (logout global)', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([
        { id: 'sess-1', companyId: 'c1', refreshTokenId: 'rt-1' },
        { id: 'sess-2', companyId: 'c1', refreshTokenId: 'rt-2' },
      ]);

      const count = await service.revokeAllSessions('u1', 'LOGOUT' as any);

      expect(count).toBe(2);
      expect(mockPrisma.userSession.update).toHaveBeenCalledTimes(2);
      expect(mockDenylist.deny).not.toHaveBeenCalled(); // LOGOUT não é crítico
    });

    it('revokeAllSessions com motivo SECURITY denylista cada sessão', async () => {
      mockPrisma.userSession.findMany.mockResolvedValue([
        { id: 'sess-1', companyId: 'c1', refreshTokenId: 'rt-1' },
        { id: 'sess-2', companyId: 'c1', refreshTokenId: 'rt-2' },
      ]);

      await service.revokeAllSessions('u1', 'SECURITY' as any);

      expect(mockDenylist.deny).toHaveBeenCalledWith('sess-1');
      expect(mockDenylist.deny).toHaveBeenCalledWith('sess-2');
    });
  });

  // ─── Dispositivos ──────────────────────────────────────────────────────────

  describe('dispositivos', () => {
    it('trustDevice marca como confiável só se o device for do usuário', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({ id: 'dev-1', userId: 'u1' });
      mockPrisma.trustedDevice.update.mockResolvedValue({ id: 'dev-1', trusted: true });

      await service.trustDevice('dev-1', 'u1', 'u1');

      expect(mockPrisma.trustedDevice.update).toHaveBeenCalledWith({
        where: { id: 'dev-1' },
        data: { trusted: true, trustedAt: expect.any(Date), trustedBy: 'u1' },
      });
    });

    it('trustDevice de device de outro usuário → 404', async () => {
      mockPrisma.trustedDevice.findUnique.mockResolvedValue({ id: 'dev-1', userId: 'outro' });

      await expect(service.trustDevice('dev-1', 'u1', 'u1')).rejects.toThrow(NotFoundException);
    });
  });
});
