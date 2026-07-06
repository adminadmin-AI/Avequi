import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../iam/session.service';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

const mockJwt = {
  sign: jest.fn(),
  verify: jest.fn(),
};

// #342: SessionService mockado — o AuthService delega sessões/lockout a ele.
const mockSessionService = {
  assertNotLocked: jest.fn(),
  recordLoginAttempt: jest.fn(),
  clearLockout: jest.fn(),
  createSession: jest.fn(),
  validateSessionForRefresh: jest.fn(),
  attachRefreshToSession: jest.fn(),
  revokeSessionByRefreshTokenId: jest.fn(),
};

const mockUser = {
  id: 'user-1',
  email: 'admin@gdr.com.br',
  name: 'Admin',
  role: 'SUPER_ADMIN',
  companyId: 'company-1',
  passwordHash: '$2a$10$hashedpassword',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
    // Defaults #342: conta não trancada, sessão criada, sessão ativa no refresh
    mockSessionService.assertNotLocked.mockResolvedValue(undefined);
    mockSessionService.recordLoginAttempt.mockResolvedValue(undefined);
    mockSessionService.clearLockout.mockResolvedValue(undefined);
    mockSessionService.createSession.mockResolvedValue({ id: 'sess-1' });
    mockSessionService.validateSessionForRefresh.mockResolvedValue({
      active: true,
      session: { id: 'sess-1', lastActivityAt: new Date() },
    });
    mockSessionService.attachRefreshToSession.mockResolvedValue(undefined);
    mockSessionService.revokeSessionByRefreshTokenId.mockResolvedValue(undefined);
  });

  // ─── validateUser ──────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('should return user without passwordHash when credentials are valid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.validateUser('admin@gdr.com.br', 'Admin@123');

      expect(result).toBeDefined();
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe('user-1');
      expect(result.email).toBe('admin@gdr.com.br');
    });

    it('should return null when user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.validateUser('unknown@test.com', 'password');

      expect(result).toBeNull();
    });

    it('should return null when password is invalid', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

      const result = await service.validateUser('admin@gdr.com.br', 'wrongpassword');

      expect(result).toBeNull();
    });

    it('should return null when user is inactive (#221)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      const result = await service.validateUser('admin@gdr.com.br', 'Admin@123');

      expect(result).toBeNull();
    });

    // ─── #342: lockout e anti-enumeração ─────────────────────────────────────

    it('should propagate 423 when account is locked (#342)', async () => {
      mockSessionService.assertNotLocked.mockRejectedValue(new HttpException('locked', 423));

      await expect(service.validateUser('admin@gdr.com.br', 'x')).rejects.toThrow(HttpException);
      // Trancado NÃO chega a consultar o usuário (nem revela se existe)
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should record failed attempt with SAME reason for unknown email and wrong password (anti-enumeração, #342)', async () => {
      // e-mail inexistente
      mockPrisma.user.findUnique.mockResolvedValue(null);
      expect(await service.validateUser('ghost@test.com', 'x')).toBeNull();

      // senha errada em conta real
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      expect(await service.validateUser('admin@gdr.com.br', 'errada')).toBeNull();

      const reasons = mockSessionService.recordLoginAttempt.mock.calls.map((c) => c[3]);
      expect(reasons).toEqual(['WRONG_PASSWORD', 'WRONG_PASSWORD']);
    });

    it('should record failed attempt with INACTIVE reason but still return null (#342)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });

      expect(await service.validateUser('admin@gdr.com.br', 'Admin@123')).toBeNull();
      expect(mockSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        'admin@gdr.com.br',
        expect.anything(),
        false,
        'INACTIVE',
      );
    });

    it('should record success attempt and clear lockout on valid login (#342)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      await service.validateUser('admin@gdr.com.br', 'Admin@123');

      expect(mockSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        'admin@gdr.com.br',
        expect.anything(),
        true,
      );
      expect(mockSessionService.clearLockout).toHaveBeenCalledWith('user-1');
    });
  });

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('should return accessToken, refreshToken and user with hashed storage (#221)', async () => {
      // #342: ordem de assinatura mudou — refresh primeiro (a sessão precisa
      // existir antes de assinar o access com o claim sessionId)
      mockJwt.sign
        .mockReturnValueOnce('refresh-token-456')
        .mockReturnValueOnce('access-token-123');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const user = { id: 'user-1', email: 'admin@gdr.com.br', role: 'SUPER_ADMIN', companyId: 'company-1' };
      const result = await service.login(user);

      expect(result.accessToken).toBe('access-token-123');
      expect(result.refreshToken).toBe('refresh-token-456');
      expect(result.user).toEqual(user);
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
      // Token stored as SHA-256 hash, not plaintext
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            token: hashToken('refresh-token-456'),
            userId: 'user-1',
          }),
        }),
      );
    });

    it('should create session bound to refresh token and add sessionId claim (#342)', async () => {
      mockJwt.sign.mockReturnValueOnce('refresh-tk').mockReturnValueOnce('access-tk');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const user = { id: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1' };
      await service.login(user, { ipAddress: '10.0.0.1', userAgent: 'Edge' });

      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        { id: 'user-1', companyId: 'company-1' },
        { ipAddress: '10.0.0.1', userAgent: 'Edge' },
        'rt-1',
      );
      // access token = 2ª assinatura, payload compat + sessionId
      expect(mockJwt.sign).toHaveBeenNthCalledWith(2, {
        sub: 'user-1',
        email: 'a@b.c',
        role: 'READER',
        companyId: 'company-1',
        sessionId: 'sess-1',
      });
    });

    it('should still login WITHOUT sessionId claim when session creation fails (failsafe, #342)', async () => {
      mockSessionService.createSession.mockResolvedValue(null);
      mockJwt.sign.mockReturnValueOnce('refresh-tk').mockReturnValueOnce('access-tk');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const user = { id: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1' };
      const result = await service.login(user);

      expect(result.accessToken).toBe('access-tk');
      expect(mockJwt.sign).toHaveBeenNthCalledWith(2, {
        sub: 'user-1',
        email: 'a@b.c',
        role: 'READER',
        companyId: 'company-1',
      });
    });
  });

  // ─── refresh ───────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('should rotate tokens when refresh token is valid', async () => {
      const payload = { sub: 'user-1', email: 'admin@gdr.com.br', role: 'SUPER_ADMIN', companyId: 'company-1', iat: 123, exp: 456 };
      mockJwt.verify.mockReturnValue(payload);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('old-refresh'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: true });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockJwt.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.refresh('old-refresh');

      expect(result.accessToken).toBe('new-access-token');
      expect(result.refreshToken).toBe('new-refresh-token');
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('should keep the SAME session across rotation, re-binding the new refresh token (#342)', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1',
        sessionId: 'sess-1', iat: 1, exp: 2,
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('old'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: true });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockJwt.sign.mockReturnValueOnce('new-access').mockReturnValueOnce('new-refresh');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      await service.refresh('old');

      expect(mockSessionService.validateSessionForRefresh).toHaveBeenCalledWith('rt-1');
      // rotação NÃO cria sessão nova — reamarra o novo token à mesma sessão
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
      expect(mockSessionService.attachRefreshToSession).toHaveBeenCalledWith('sess-1', 'rt-2');
      // access novo mantém o claim sessionId
      expect(mockJwt.sign).toHaveBeenNthCalledWith(1, {
        sub: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1', sessionId: 'sess-1',
      });
    });

    it('should reject refresh when the bound session was revoked (#342)', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', iat: 1, exp: 2 });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('t'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: true });
      mockSessionService.validateSessionForRefresh.mockResolvedValue({ active: false, session: null });

      await expect(service.refresh('t')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('should accept legacy refresh token WITHOUT session (transição M4, #342)', async () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1', iat: 1, exp: 2,
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-legacy',
        token: hashToken('legacy'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: true });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockSessionService.validateSessionForRefresh.mockResolvedValue({ active: true, session: null });
      mockJwt.sign.mockReturnValueOnce('new-access').mockReturnValueOnce('new-refresh');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.refresh('legacy');

      expect(result.accessToken).toBe('new-access');
      // sem sessão → access sem claim sessionId, nada para reamarrar
      expect(mockJwt.sign).toHaveBeenNthCalledWith(1, {
        sub: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1',
      });
      expect(mockSessionService.attachRefreshToSession).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException when user is inactive (#221)', async () => {
      const payload = { sub: 'user-1', iat: 1, exp: 2 };
      mockJwt.verify.mockReturnValue(payload);
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('some-token'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: false });

      await expect(service.refresh('some-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when JWT verify fails', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token is already revoked', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', iat: 1, exp: 2 });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('revoked-token'),
        userId: 'user-1',
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      });

      await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token is expired in DB', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', iat: 1, exp: 2 });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('expired-token'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() - 86400000),
      });

      await expect(service.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token not found in DB', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', iat: 1, exp: 2 });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── logout ────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should revoke refresh token and its session (#342)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('valid-token'),
        revokedAt: null,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await service.logout('valid-token');

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
      expect(mockSessionService.revokeSessionByRefreshTokenId).toHaveBeenCalledWith(
        'rt-1',
        'LOGOUT',
      );
    });

    it('should do nothing when refreshToken is empty', async () => {
      await service.logout('');

      expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('should do nothing when token is already revoked', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('already-revoked'),
        revokedAt: new Date(),
      });

      await service.logout('already-revoked');

      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeSessionByRefreshTokenId).not.toHaveBeenCalled();
    });

    it('should do nothing when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await service.logout('not-found-token');

      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
