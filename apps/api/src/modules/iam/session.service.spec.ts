import { HttpException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionDenylistService } from './session-denylist.service';
import { AuditService } from './audit.service';
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

/** #1001-C2: auditoria mockada para provar que o ATOR vai para a trilha. */
const mockAudit = {
  logWithDiff: jest.fn(),
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
        { provide: AuditService, useValue: mockAudit },
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

    // ── #1001-C2: escopo empresarial e auditoria do ator ───────────────────

    it('#1001-C2: sessão FORA do escopo autorizado → 404, sem revogar nada', async () => {
      // Mesma resposta de "não existe": distinguir os casos entregaria um
      // oráculo de sessões alheias a quem não pode agir sobre elas.
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-outra-empresa',
        userId: 'u-de-outro-tenant',
        companyId: 'c-outra',
        refreshTokenId: 'rt-9',
        revokedAt: null,
      });

      await expect(
        service.revokeSession('sess-outra-empresa', 'ADMIN_REVOKE' as any, undefined, {
          actorUserId: 'admin-1',
          allowedCompanyIds: ['c1', 'c2'],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.userSession.update).not.toHaveBeenCalled();
      expect(mockDenylist.deny).not.toHaveBeenCalled();
    });

    it('#1001-C2: sessão DENTRO do escopo é revogada normalmente', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-2',
        userId: 'vitima',
        companyId: 'c2',
        refreshTokenId: 'rt-2',
        revokedAt: null,
      });

      await service.revokeSession('sess-2', 'ADMIN_REVOKE' as any, undefined, {
        actorUserId: 'admin-1',
        allowedCompanyIds: ['c1', 'c2'],
      });

      expect(mockPrisma.userSession.update).toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled(); // refresh invalidado
      expect(mockDenylist.deny).toHaveBeenCalledWith('sess-2'); // access na denylist
    });

    it('#1001-C2: a auditoria registra o ATOR, não a vítima', async () => {
      // Era aqui que a trilha mentia: `expectedUserId ?? session.userId`
      // gravava o dono da sessão sempre que um admin revogava, porque nesse
      // caminho o expected é undefined. Quem revogou ficava invisível.
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-3',
        userId: 'vitima',
        companyId: 'c1',
        refreshTokenId: 'rt-3',
        revokedAt: null,
      });

      await service.revokeSession('sess-3', 'ADMIN_REVOKE' as any, undefined, {
        actorUserId: 'admin-1',
        allowedCompanyIds: ['c1'],
      });

      expect(mockAudit.logWithDiff).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ userId: 'admin-1', entity: 'UserSession' }),
      );
    });

    it('#1001-C2: o SecurityEvent continua sendo da VÍTIMA, com o ator no metadado', async () => {
      // O histórico de segurança de quem teve a sessão derrubada precisa
      // mostrar o evento — mas com rastro de quem fez.
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-4',
        userId: 'vitima',
        companyId: 'c1',
        refreshTokenId: 'rt-4',
        revokedAt: null,
      });

      await service.revokeSession('sess-4', 'ADMIN_REVOKE' as any, undefined, {
        actorUserId: 'admin-1',
        allowedCompanyIds: ['c1'],
      });

      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'vitima',
          metadata: expect.objectContaining({ actorUserId: 'admin-1', porTerceiro: true }),
        }),
      });
    });

    it('#1001-C2: logout próprio marca porTerceiro=false', async () => {
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-5',
        userId: 'u1',
        companyId: 'c1',
        refreshTokenId: 'rt-5',
        revokedAt: null,
      });

      await service.revokeSession('sess-5', 'LOGOUT' as any, 'u1', { actorUserId: 'u1' });

      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: expect.objectContaining({ actorUserId: 'u1', porTerceiro: false }),
        }),
      });
    });

    it('#1001-C2: sem escopo informado o comportamento antigo é preservado', async () => {
      // Chamadas internas (troca de senha, incidente de segurança) continuam
      // funcionando sem passar escopo — a restrição é só do caminho HTTP.
      mockPrisma.userSession.findUnique.mockResolvedValue({
        id: 'sess-6',
        userId: 'u1',
        companyId: 'c-qualquer',
        refreshTokenId: 'rt-6',
        revokedAt: null,
      });

      await service.revokeSession('sess-6', 'SECURITY' as any);

      expect(mockPrisma.userSession.update).toHaveBeenCalled();
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

  // ─── #1146: revogação transacional das outras sessões ──────────────────────

  describe('revokeOtherSessionsInTransaction (#1146)', () => {
    /** Client de transação separado do mockPrisma: prova que só o tx é usado. */
    const tx = {
      userSession: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      refreshToken: { updateMany: jest.fn() },
      securityEvent: { create: jest.fn() },
    };

    beforeEach(() => {
      tx.userSession.findUnique.mockReset();
      tx.userSession.findMany.mockReset();
      tx.userSession.update.mockReset().mockResolvedValue({});
      tx.refreshToken.updateMany.mockReset().mockResolvedValue({ count: 0 });
      tx.securityEvent.create.mockReset().mockResolvedValue({});
    });

    it('modo normal: localiza a sessão corrente pelo ID persistido, preserva SÓ o refresh dela e revoga todos os outros refresh do usuário (inclusive órfãos)', async () => {
      tx.userSession.findUnique.mockResolvedValue({ userId: 'u1', revokedAt: null, refreshTokenId: 'rt-atual' });
      tx.userSession.findMany.mockResolvedValue([
        { id: 'sess-1', companyId: 'c1' },
        { id: 'sess-2', companyId: 'c1' },
      ]);
      // 2 refresh das outras sessões + 1 órfão sem UserSession.
      tx.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.revokeOtherSessionsInTransaction(
        tx as any,
        'u1',
        'SECURITY' as any,
        'sess-atual',
      );

      expect(result).toEqual({
        sessionIds: ['sess-1', 'sess-2'],
        count: 2,
        companyId: 'c1',
        refreshTokensRevokedCount: 3,
        preservedRefreshTokenId: 'rt-atual',
      });
      expect(tx.userSession.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sess-atual' } }),
      );
      // Respeita a sessão corrente e só busca ativas.
      expect(tx.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', revokedAt: null, id: { not: 'sess-atual' } },
        }),
      );
      expect(tx.userSession.update).toHaveBeenCalledTimes(2);
      expect(tx.userSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-1' },
        data: { revokedAt: expect.any(Date), revokedReason: 'SECURITY' },
      });
      // Um ÚNICO updateMany por userId — não depende da enumeração de sessões.
      expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null, id: { not: 'rt-atual' } },
        data: { revokedAt: expect.any(Date) },
      });
      expect(tx.securityEvent.create).toHaveBeenCalledWith({
        data: {
          companyId: 'c1',
          userId: 'u1',
          eventType: 'SESSION_REVOKED',
          severity: 'CRITICAL',
          metadata: { count: 2, reason: 'SECURITY', global: true },
        },
      });
      // Nada fora da transação: nem PrismaService, nem Redis.
      expect(mockPrisma.userSession.update).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.securityEvent.create).not.toHaveBeenCalled();
      expect(mockDenylist.deny).not.toHaveBeenCalled();
    });

    it('modo restrito (sem sessão corrente): revoga TODAS as sessões ativas e TODOS os refresh ativos do usuário', async () => {
      tx.userSession.findMany.mockResolvedValue([{ id: 'sess-1', companyId: 'c1' }]);
      tx.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any);

      expect(tx.userSession.findUnique).not.toHaveBeenCalled();
      expect(tx.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
      );
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result).toMatchObject({ count: 1, refreshTokensRevokedCount: 2, preservedRefreshTokenId: null });
    });

    it('zero outras sessões → count 0, SEM SESSION_REVOKED fictício; refresh órfãos ainda são revogados e contados à parte', async () => {
      tx.userSession.findUnique.mockResolvedValue({ userId: 'u1', revokedAt: null, refreshTokenId: 'rt-atual' });
      tx.userSession.findMany.mockResolvedValue([]);
      tx.refreshToken.updateMany.mockResolvedValue({ count: 1 }); // um órfão

      const result = await service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any, 'sess-atual');

      expect(result).toEqual({
        sessionIds: [],
        count: 0,
        companyId: null,
        refreshTokensRevokedCount: 1,
        preservedRefreshTokenId: 'rt-atual',
      });
      expect(tx.userSession.update).not.toHaveBeenCalled();
      expect(tx.securityEvent.create).not.toHaveBeenCalled();
    });

    it('sessão corrente sem refresh vinculado (refreshTokenId null) → nenhum refresh é preservado', async () => {
      tx.userSession.findUnique.mockResolvedValue({ userId: 'u1', revokedAt: null, refreshTokenId: null });
      tx.userSession.findMany.mockResolvedValue([]);

      const result = await service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any, 'sess-atual');

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.preservedRefreshTokenId).toBeNull();
    });

    it.each([
      ['inexistente', null],
      ['de OUTRO usuário', { userId: 'u2', revokedAt: null, refreshTokenId: 'rt-x' }],
      ['já revogada', { userId: 'u1', revokedAt: new Date(), refreshTokenId: 'rt-x' }],
    ])('sessão corrente %s → 401 fail-closed ANTES de qualquer escrita', async (_rotulo, row) => {
      tx.userSession.findUnique.mockResolvedValue(row);

      await expect(
        service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any, 'sess-atual'),
      ).rejects.toThrow('Sessão inválida ou expirada. Faça login novamente.');
      expect(tx.userSession.findMany).not.toHaveBeenCalled();
      expect(tx.userSession.update).not.toHaveBeenCalled();
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(tx.securityEvent.create).not.toHaveBeenCalled();
    });

    it('falha na segunda sessão PROPAGA (quem abriu a transação faz rollback) e não grava evento', async () => {
      tx.userSession.findMany.mockResolvedValue([
        { id: 'sess-1', companyId: 'c1' },
        { id: 'sess-2', companyId: 'c1' },
      ]);
      tx.userSession.update.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any),
      ).rejects.toThrow('db down');
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(tx.securityEvent.create).not.toHaveBeenCalled();
      expect(mockDenylist.deny).not.toHaveBeenCalled();
    });

    it('falha ao revogar os refresh tokens PROPAGA (nenhum refresh fica parcialmente revogado)', async () => {
      tx.userSession.findMany.mockResolvedValue([{ id: 'sess-1', companyId: 'c1' }]);
      tx.refreshToken.updateMany.mockRejectedValue(new Error('refresh down'));

      await expect(
        service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any),
      ).rejects.toThrow('refresh down');
      expect(tx.securityEvent.create).not.toHaveBeenCalled();
    });

    it('falha ao gravar SESSION_REVOKED também PROPAGA (auditoria faz parte da unidade)', async () => {
      tx.userSession.findMany.mockResolvedValue([{ id: 'sess-1', companyId: 'c1' }]);
      tx.securityEvent.create.mockRejectedValue(new Error('audit down'));

      await expect(
        service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'SECURITY' as any),
      ).rejects.toThrow('audit down');
    });

    it('reason não crítico usa severidade INFO no SESSION_REVOKED', async () => {
      tx.userSession.findMany.mockResolvedValue([{ id: 'sess-1', companyId: 'c1' }]);

      await service.revokeOtherSessionsInTransaction(tx as any, 'u1', 'LOGOUT' as any);

      expect(tx.securityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ severity: 'INFO' }) }),
      );
    });
  });

  describe('denylistRevokedSessions (#1146, pós-commit)', () => {
    it('aplica deny em cada sessão e devolve 0 falhas quando o Redis confirma (true)', async () => {
      mockDenylist.deny.mockResolvedValue(true);

      const failures = await service.denylistRevokedSessions(['sess-1', 'sess-2']);

      expect(failures).toBe(0);
      expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
    });

    it('conta o resultado REAL do serviço: false (Redis indisponível, contrato que não lança) = falha', async () => {
      mockDenylist.deny
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const failures = await service.denylistRevokedSessions(['a', 'b', 'c']);

      expect(failures).toBe(2);
      expect(mockDenylist.deny).toHaveBeenCalledTimes(3);
    });

    it('defesa em profundidade: exceção inesperada também conta como falha e não impede as demais', async () => {
      mockDenylist.deny.mockRejectedValueOnce(new Error('bug')).mockResolvedValueOnce(true);

      expect(await service.denylistRevokedSessions(['a', 'b'])).toBe(1);
      expect(mockDenylist.deny).toHaveBeenCalledTimes(2);
    });

    it('lista vazia → nenhuma chamada', async () => {
      expect(await service.denylistRevokedSessions([])).toBe(0);
      expect(mockDenylist.deny).not.toHaveBeenCalled();
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
