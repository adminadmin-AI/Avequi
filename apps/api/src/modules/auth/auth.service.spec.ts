import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

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
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();
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
  });

  // ─── login ─────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('should return accessToken, refreshToken and user with hashed storage (#221)', async () => {
      mockJwt.sign
        .mockReturnValueOnce('access-token-123')
        .mockReturnValueOnce('refresh-token-456');
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
    it('should revoke refresh token', async () => {
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
    });

    it('should do nothing when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await service.logout('not-found-token');

      expect(mockPrisma.refreshToken.update).not.toHaveBeenCalled();
    });
  });
});
