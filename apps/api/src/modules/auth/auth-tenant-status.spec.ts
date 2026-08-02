import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { LoginFailReason, TenantStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { TenantStatusService } from '../iam/tenant-status.service';

/**
 * OPS WP1 (#908) — tenant SUSPENDED/CHURNED não autentica.
 *
 * Contratos cobertos:
 * - o check roda DEPOIS da senha (anti-enumeração #342 intacta: quem erra a
 *   senha num tenant suspenso recebe o mesmo 401 genérico de sempre);
 * - credencial válida + tenant bloqueado → 403 com mensagem de regularização
 *   + LoginAttempt(TENANT_SUSPENDED);
 * - refresh de tenant bloqueado morre mesmo sem sessão (defesa em
 *   profundidade além da revogação feita pelo OpsService).
 */

const mockPrisma = {
  user: { findUnique: jest.fn() },
  refreshToken: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
};

const mockJwt = { sign: jest.fn(), verify: jest.fn() };

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

const mockMfaService = {
  isEnabled: jest.fn(),
  roleRequiresMfa: jest.fn(),
  verifyCode: jest.fn(),
  recordFailedVerify: jest.fn(),
};

const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  assertNotReused: jest.fn(),
  recordPasswordChange: jest.fn(),
  getMaxAgeDays: jest.fn(),
  isPasswordExpired: jest.fn(),
  getPolicy: jest.fn(),
};

const mockTenantStatus = {
  getTenantRoot: jest.fn(),
  getLoginBlock: jest.fn(),
};

const SUSPENDED_BLOCK = {
  status: TenantStatus.SUSPENDED,
  message:
    'O acesso da sua empresa está temporariamente suspenso. ' +
    'Procure o responsável pela conta para regularização junto à Avecchi.',
};

const mockUser = {
  id: 'user-1',
  email: 'admin@gdr.com.br',
  name: 'Admin',
  role: 'SUPER_ADMIN',
  companyId: 'company-1',
  passwordHash: '$2a$10$hashedpassword',
  isActive: true,
  mustChangePassword: false,
  passwordChangedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService — bloqueio por status do tenant (OPS WP1 #908)', () => {
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

    service = module.get(AuthService);
    jest.clearAllMocks();
    jest.restoreAllMocks();

    mockSessionService.assertNotLocked.mockResolvedValue(undefined);
    mockSessionService.recordLoginAttempt.mockResolvedValue(undefined);
    mockSessionService.clearLockout.mockResolvedValue(undefined);
    mockTenantStatus.getLoginBlock.mockResolvedValue(null);
  });

  describe('validateUser', () => {
    it('tenant suspenso + senha CORRETA → 403 com mensagem de regularização', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockTenantStatus.getLoginBlock.mockResolvedValue(SUSPENDED_BLOCK);

      await expect(
        service.validateUser('admin@gdr.com.br', 'Admin@123'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.validateUser('admin@gdr.com.br', 'Admin@123'),
      ).rejects.toThrow(/suspenso/);
    });

    it('tenant suspenso registra LoginAttempt(TENANT_SUSPENDED), não sucesso', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
      mockTenantStatus.getLoginBlock.mockResolvedValue(SUSPENDED_BLOCK);

      await expect(
        service.validateUser('admin@gdr.com.br', 'Admin@123'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        'admin@gdr.com.br',
        expect.anything(),
        false,
        LoginFailReason.TENANT_SUSPENDED,
      );
      expect(mockSessionService.clearLockout).not.toHaveBeenCalled();
    });

    it('anti-enumeração intacta: senha ERRADA em tenant suspenso → null (401 genérico), sem consultar tenant', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);
      mockTenantStatus.getLoginBlock.mockResolvedValue(SUSPENDED_BLOCK);

      const result = await service.validateUser('admin@gdr.com.br', 'senha-errada');

      expect(result).toBeNull();
      expect(mockTenantStatus.getLoginBlock).not.toHaveBeenCalled();
      expect(mockSessionService.recordLoginAttempt).toHaveBeenCalledWith(
        'admin@gdr.com.br',
        expect.anything(),
        false,
        LoginFailReason.WRONG_PASSWORD,
      );
    });

    it('tenant ACTIVE → login segue normal', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);

      const result = await service.validateUser('admin@gdr.com.br', 'Admin@123');

      expect(result).toBeTruthy();
      expect(result).not.toHaveProperty('passwordHash');
      expect(mockTenantStatus.getLoginBlock).toHaveBeenCalledWith('company-1');
    });
  });

  describe('refresh', () => {
    function setupValidRefresh() {
      mockJwt.verify.mockReturnValue({
        sub: 'user-1',
        email: 'admin@gdr.com.br',
        role: 'SUPER_ADMIN',
        companyId: 'company-1',
        iat: 123,
        exp: 456,
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        isActive: true,
        mustChangePassword: false,
        companyId: 'company-1',
      });
    }

    it('tenant suspenso → refresh negado com 403 (mesmo refresh válido)', async () => {
      setupValidRefresh();
      mockTenantStatus.getLoginBlock.mockResolvedValue(SUSPENDED_BLOCK);

      await expect(service.refresh('old-refresh')).rejects.toThrow(
        ForbiddenException,
      );
      // Nenhum token novo emitido
      expect(mockJwt.sign).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('tenant ACTIVE → refresh rotaciona normalmente', async () => {
      setupValidRefresh();
      mockSessionService.validateSessionForRefresh.mockResolvedValue({
        active: true,
        session: { id: 'sess-1', lastActivityAt: new Date() },
      });
      mockSessionService.attachRefreshToSession.mockResolvedValue(undefined);
      mockPrisma.refreshToken.update.mockResolvedValue({});
      mockJwt.sign
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      mockPrisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.refresh('old-refresh');

      expect(result.accessToken).toBe('new-access-token');
      expect(mockTenantStatus.getLoginBlock).toHaveBeenCalledWith('company-1');
    });
  });
});
