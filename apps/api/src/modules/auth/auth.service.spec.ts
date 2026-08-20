import { HttpException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService, MFA_PENDING_SCOPE } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { TenantStatusService } from '../iam/tenant-status.service';

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
  revokeAllSessions: jest.fn(),
};

// #344: MfaService mockado — default SEM MFA (fluxo antigo intacto).
const mockMfaService = {
  isEnabled: jest.fn(),
  roleRequiresMfa: jest.fn(),
  verifyCode: jest.fn(),
  recordFailedVerify: jest.fn(),
};

// #345: PasswordPolicyService mockado — default senha OK (fluxo antigo intacto).
const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  assertNotReused: jest.fn(),
  recordPasswordChange: jest.fn(),
  getMaxAgeDays: jest.fn(),
  isPasswordExpired: jest.fn(),
  getPolicy: jest.fn(),
};

// OPS WP1 (#908): TenantStatusService mockado — default tenant liberado.
const mockTenantStatus = {
  getTenantRoot: jest.fn(),
  getLoginBlock: jest.fn(),
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
        { provide: MfaService, useValue: mockMfaService },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: TenantStatusService, useValue: mockTenantStatus },
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
    mockSessionService.revokeAllSessions.mockResolvedValue(0);
    // Defaults #344: MFA desabilitado — login segue o fluxo de sempre.
    mockMfaService.isEnabled.mockResolvedValue(false);
    mockMfaService.roleRequiresMfa.mockResolvedValue(false);
    mockMfaService.verifyCode.mockResolvedValue(false);
    mockMfaService.recordFailedVerify.mockResolvedValue(undefined);
    // Defaults #345: senha dentro da política e não vencida.
    mockPasswordPolicy.validateComplexity.mockReturnValue(undefined);
    mockPasswordPolicy.assertNotReused.mockResolvedValue(undefined);
    mockPasswordPolicy.recordPasswordChange.mockResolvedValue(undefined);
    mockPasswordPolicy.isPasswordExpired.mockResolvedValue(false);
    mockPasswordPolicy.getMaxAgeDays.mockResolvedValue(null);
    // Default OPS WP1 (#908): tenant ACTIVE — login/refresh liberados.
    mockTenantStatus.getLoginBlock.mockResolvedValue(null);
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

    it('#750: refresh com mustChangePassword=true é NEGADO — revoga refresh + sessões e não emite token', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', iat: 1, exp: 2 });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('t'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, mustChangePassword: true });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await expect(service.refresh('t')).rejects.toThrow(
        'Troca de senha obrigatória. Faça login novamente.',
      );
      // O refresh apresentado morre (não pode ser reapresentado)...
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-1' }, data: { revokedAt: expect.any(Date) } }),
      );
      // ...as sessões restantes do ALVO caem (SECURITY → denylist)...
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith('user-1', 'SECURITY');
      // ...e NENHUM token novo é emitido.
      expect(mockJwt.sign).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('#750: falha na revogação de sessões não muda a resposta — refresh segue negado sem token novo', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', iat: 1, exp: 2 });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('t'),
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ isActive: true, mustChangePassword: true });
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockSessionService.revokeAllSessions.mockRejectedValueOnce(new Error('redis fora'));

      await expect(service.refresh('t')).rejects.toThrow(UnauthorizedException);
      expect(mockJwt.sign).not.toHaveBeenCalled();
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
    // #67: os mocks abaixo passaram a carregar `userId`, que é o dono
    // persistido do refresh token (coluna NOT NULL, FK para gdr_users). Antes
    // eles omitiam o campo porque o logout não o consultava — era exatamente
    // a falha corrigida aqui, não uma regressão dos testes.
    const DONO = 'user-a';
    const OUTRO = 'user-b';

    it('should revoke refresh token and its session (#342)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('valid-token'),
        userId: DONO,
        revokedAt: null,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await service.logout('valid-token', DONO);

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
      await service.logout('', DONO);

      expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('should do nothing when token is already revoked', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('already-revoked'),
        userId: DONO,
        revokedAt: new Date(),
      });

      await service.logout('already-revoked', DONO);

      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeSessionByRefreshTokenId).not.toHaveBeenCalled();
    });

    it('should do nothing when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await service.logout('not-found-token', DONO);

      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });

    // ─── #67: posse do token não é autorização ──────────────────────────────

    it('#67: NÃO revoga o refresh token de outro usuário', async () => {
      // O token existe e é válido — só que é do usuário B. Quem chama é A.
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-do-b',
        token: hashToken('token-do-b'),
        userId: OUTRO,
        revokedAt: null,
      });

      await service.logout('token-do-b', DONO);

      // Nada do B é tocado: nem o token, nem a sessão.
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeSessionByRefreshTokenId).not.toHaveBeenCalled();
    });

    it('#67: token de terceiro é indistinguível de token inexistente (sem oráculo)', async () => {
      // Caminho A — token de outro usuário.
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-do-b',
        token: hashToken('token-do-b'),
        userId: OUTRO,
        revokedAt: null,
      });
      const terceiro = await service.logout('token-do-b', DONO);

      jest.clearAllMocks();

      // Caminho B — token que não existe.
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      const inexistente = await service.logout('token-que-nao-existe', DONO);

      // Mesmo retorno (void) e mesma ausência de efeito: nada no retorno nem
      // no comportamento diferencia os dois casos para quem está de fora.
      expect(terceiro).toBeUndefined();
      expect(inexistente).toBeUndefined();
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeSessionByRefreshTokenId).not.toHaveBeenCalled();
    });

    it('#67: usa o userId PERSISTIDO na comparação, não o token apresentado', async () => {
      // A linha do banco é a fonte de verdade do dono. Aqui ela diz que o
      // token é do DONO e o ator é o DONO — tem que revogar.
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('valid-token'),
        userId: DONO,
        revokedAt: null,
      });
      mockPrisma.refreshToken.update.mockResolvedValue({});

      await service.logout('valid-token', DONO);

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-1' } }),
      );
    });

    it('#67: sem ator identificado é no-op (fail-closed)', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('valid-token'),
        userId: DONO,
        revokedAt: null,
      });

      await service.logout('valid-token', undefined);

      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeSessionByRefreshTokenId).not.toHaveBeenCalled();
    });

    it('#67: logout repetido continua idempotente, sem erro', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        token: hashToken('valid-token'),
        userId: DONO,
        revokedAt: new Date(), // já revogado pela primeira chamada
      });

      await expect(service.logout('valid-token', DONO)).resolves.toBeUndefined();
      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });

  // ─── MFA — login em 2 passos (#344) ────────────────────────────────────────

  describe('login com MFA habilitado (#344)', () => {
    const user = { id: 'user-1', email: 'a@b.c', role: 'READER', companyId: 'company-1' };

    it('should return mfaPendingToken WITHOUT final tokens, session or refresh', async () => {
      mockMfaService.isEnabled.mockResolvedValue(true);
      mockJwt.sign.mockReturnValue('pending-tk');

      const result = await service.login(user);

      expect(result).toEqual({ mfaRequired: true, mfaPendingToken: 'pending-tk' });
      // pending token com claim de escopo restrito e vida de 2min
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { sub: 'user-1', scope: MFA_PENDING_SCOPE },
        { expiresIn: '2m' },
      );
      // NENHUM token final antes do 2º passo
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('should flag mfaSetupRequired (soft enforcement) when role requires MFA and user has none', async () => {
      mockMfaService.isEnabled.mockResolvedValue(false);
      mockMfaService.roleRequiresMfa.mockResolvedValue(true);
      mockJwt.sign.mockReturnValueOnce('refresh-tk').mockReturnValueOnce('access-tk');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login(user);

      // enforcement SUAVE: tokens saem normalmente, só sinaliza
      expect(result.accessToken).toBe('access-tk');
      expect(result.mfaSetupRequired).toBe(true);
    });

    it('should NOT change legacy login response when MFA is disabled (compatibilidade)', async () => {
      mockJwt.sign.mockReturnValueOnce('refresh-tk').mockReturnValueOnce('access-tk');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login(user);

      expect(result).not.toHaveProperty('mfaRequired');
      expect(result).not.toHaveProperty('mfaSetupRequired');
      expect(result.accessToken).toBe('access-tk');
    });
  });

  describe('loginWithMfa (#344)', () => {
    const dbUser = { ...mockUser };

    it('should issue final tokens when pending token and TOTP code are valid', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: MFA_PENDING_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockMfaService.verifyCode.mockResolvedValue(true);
      mockJwt.sign.mockReturnValueOnce('refresh-tk').mockReturnValueOnce('access-tk');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.loginWithMfa('pending-tk', '123456', { ipAddress: '1.2.3.4' });

      expect(result.accessToken).toBe('access-tk');
      expect(result.refreshToken).toBe('refresh-tk');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(mockMfaService.verifyCode).toHaveBeenCalledWith('user-1', '123456');
      // sessão criada só AGORA (2º passo)
      expect(mockSessionService.createSession).toHaveBeenCalled();
      expect(mockSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        dbUser.email,
        expect.anything(),
        true,
      );
    });

    it('should reject invalid code with 401, LoginAttempt(MFA_FAILED) and SecurityEvent', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: MFA_PENDING_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockMfaService.verifyCode.mockResolvedValue(false);

      await expect(service.loginWithMfa('pending-tk', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        dbUser.email,
        expect.anything(),
        false,
        'MFA_FAILED',
      );
      expect(mockMfaService.recordFailedVerify).toHaveBeenCalled();
      expect(mockSessionService.createSession).not.toHaveBeenCalled();
    });

    it('should reject a token WITHOUT the mfa_pending scope (access token no lugar do pending)', async () => {
      // um access token normal verificado com sucesso, mas sem o scope
      mockJwt.verify.mockReturnValue({ sub: 'user-1', email: 'a@b.c', role: 'READER' });

      await expect(service.loginWithMfa('access-tk', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockMfaService.verifyCode).not.toHaveBeenCalled();
    });

    it('should reject expired/invalid pending token', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.loginWithMfa('expired', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject when user is inactive', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: MFA_PENDING_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue({ ...dbUser, isActive: false });

      await expect(service.loginWithMfa('pending-tk', '123456')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should respect lockout on the 2nd step (brute-force de TOTP)', async () => {
      mockJwt.verify.mockReturnValue({ sub: 'user-1', scope: MFA_PENDING_SCOPE });
      mockPrisma.user.findUnique.mockResolvedValue(dbUser);
      mockSessionService.assertNotLocked.mockRejectedValue(new HttpException('locked', 423));

      await expect(service.loginWithMfa('pending-tk', '123456')).rejects.toThrow(HttpException);
      expect(mockMfaService.verifyCode).not.toHaveBeenCalled();
    });
  });
});
