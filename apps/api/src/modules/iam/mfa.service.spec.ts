import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from './mfa.service';
import { totpCode } from './totp.util';

const VALID_KEY = randomBytes(32).toString('hex');

const mockPrisma = {
  userMFA: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  userRoleAssignment: {
    count: jest.fn(),
  },
  securityEvent: {
    create: jest.fn(),
  },
  $transaction: jest.fn().mockResolvedValue([]),
};

const user = { id: 'user-1', email: 'rafael@gdr.com.br', companyId: 'company-1' };

async function buildService(key?: string): Promise<{ service: MfaService; encryption: EncryptionService }> {
  const encryption = new EncryptionService({
    get: jest.fn().mockReturnValue(key),
  } as unknown as ConfigService);
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      MfaService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EncryptionService, useValue: encryption },
    ],
  }).compile();
  return { service: module.get(MfaService), encryption };
}

describe('MfaService (#344)', () => {
  let service: MfaService;
  let encryption: EncryptionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockResolvedValue([]);
    ({ service, encryption } = await buildService(VALID_KEY));
  });

  // ─── fail-fast sem ENCRYPTION_KEY ──────────────────────────────────────────

  describe('sem ENCRYPTION_KEY', () => {
    it('setup/confirm/verify/disable respondem 503 com mensagem clara', async () => {
      const { service: noKey } = await buildService(undefined);

      await expect(noKey.setup(user)).rejects.toThrow(ServiceUnavailableException);
      await expect(noKey.confirm(user, '123456')).rejects.toThrow(ServiceUnavailableException);
      await expect(noKey.verifyCode(user.id, '123456')).rejects.toThrow(
        ServiceUnavailableException,
      );
      await expect(noKey.disable(user, 'senha', '123456')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ─── setup ─────────────────────────────────────────────────────────────────

  describe('setup', () => {
    it('should generate secret + otpauth URI and store ENCRYPTED secret with enabled=false', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue(null);
      mockPrisma.userMFA.upsert.mockResolvedValue({});

      const result = await service.setup(user);

      expect(result.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(result.otpauthUri).toContain('otpauth://totp/');
      expect(result.otpauthUri).toContain(result.secret);

      const upsert = mockPrisma.userMFA.upsert.mock.calls[0][0];
      expect(upsert.create.enabled).toBe(false);
      // secret gravado CRIPTOGRAFADO (nunca em claro)
      expect(upsert.create.secret).not.toContain(result.secret);
      expect(encryption.decrypt(upsert.create.secret)).toBe(result.secret);
    });

    it('should reject setup when MFA is already enabled (409)', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue({ enabled: true });
      await expect(service.setup(user)).rejects.toThrow(ConflictException);
    });

    it('should allow re-setup when previous setup was never confirmed', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue({ enabled: false });
      mockPrisma.userMFA.upsert.mockResolvedValue({});
      await expect(service.setup(user)).resolves.toBeDefined();
    });
  });

  // ─── confirm ───────────────────────────────────────────────────────────────

  describe('confirm', () => {
    let secret: string;
    let encryptedSecret: string;

    beforeEach(async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue(null);
      mockPrisma.userMFA.upsert.mockResolvedValue({});
      const setup = await service.setup(user);
      secret = setup.secret;
      encryptedSecret = mockPrisma.userMFA.upsert.mock.calls[0][0].create.secret;
    });

    it('should enable MFA and return 10 backup codes shown ONCE (hashes no banco)', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue({
        userId: user.id,
        secret: encryptedSecret,
        enabled: false,
        backupCodes: [],
      });

      const { backupCodes } = await service.confirm(user, totpCode(secret));

      expect(backupCodes).toHaveLength(10);
      expect(new Set(backupCodes).size).toBe(10);
      backupCodes.forEach((code) => expect(code).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/));

      // transação: update (enabled=true + hashes) + SecurityEvent MFA_ENABLED
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      const updateArg = mockPrisma.userMFA.update.mock.calls[0][0];
      const eventArg = mockPrisma.securityEvent.create.mock.calls[0][0];
      expect(updateArg.data.enabled).toBe(true);
      expect(updateArg.data.backupCodes).toHaveLength(10);
      // nenhum código em claro no banco — só hashes bcrypt
      updateArg.data.backupCodes.forEach((hash: string, i: number) => {
        expect(hash).not.toBe(backupCodes[i]);
        expect(bcrypt.compareSync(backupCodes[i], hash)).toBe(true);
      });
      expect(eventArg.data.eventType).toBe('MFA_ENABLED');
    });

    it('should reject invalid TOTP code', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue({
        userId: user.id,
        secret: encryptedSecret,
        enabled: false,
        backupCodes: [],
      });
      await expect(service.confirm(user, '000000')).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject confirm without setup', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue(null);
      await expect(service.confirm(user, '123456')).rejects.toThrow(BadRequestException);
    });

    it('should reject confirm when already enabled', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue({ enabled: true, secret: encryptedSecret });
      await expect(service.confirm(user, '123456')).rejects.toThrow(ConflictException);
    });
  });

  // ─── verifyCode (2º passo do login) ────────────────────────────────────────

  describe('verifyCode', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    let encryptedSecret: string;

    beforeEach(() => {
      encryptedSecret = encryption.encrypt(secret);
    });

    function mockRow(backupHashes: string[] = []) {
      mockPrisma.userMFA.findUnique.mockResolvedValue({
        userId: user.id,
        secret: encryptedSecret,
        enabled: true,
        backupCodes: backupHashes,
      });
    }

    it('should accept a valid TOTP code', async () => {
      mockRow();
      expect(await service.verifyCode(user.id, totpCode(secret))).toBe(true);
    });

    it('should reject an invalid code', async () => {
      mockRow();
      expect(await service.verifyCode(user.id, '000000')).toBe(false);
    });

    it('should return false when MFA is not enabled', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue({ enabled: false, secret: encryptedSecret });
      expect(await service.verifyCode(user.id, totpCode(secret))).toBe(false);
    });

    it('should accept a backup code ONCE and consume it (uso único)', async () => {
      const code = 'ab12-cd34';
      const otherHash = bcrypt.hashSync('ffff-0000', 10);
      mockRow([bcrypt.hashSync(code, 10), otherHash]);
      mockPrisma.userMFA.update.mockResolvedValue({});

      expect(await service.verifyCode(user.id, code)).toBe(true);

      // hash consumido removido do array; o outro permanece
      const update = mockPrisma.userMFA.update.mock.calls[0][0];
      expect(update.data.backupCodes).toEqual([otherHash]);

      // segunda tentativa com o MESMO código (banco já sem o hash) → falha
      mockRow([otherHash]);
      expect(await service.verifyCode(user.id, code)).toBe(false);
    });

    it('should normalize backup code input (case/espaços)', async () => {
      mockRow([bcrypt.hashSync('ab12-cd34', 10)]);
      mockPrisma.userMFA.update.mockResolvedValue({});
      expect(await service.verifyCode(user.id, '  AB12-CD34  ')).toBe(true);
    });
  });

  // ─── disable ───────────────────────────────────────────────────────────────

  describe('disable', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const password = 'Senha@123';

    beforeEach(() => {
      const encryptedSecret = encryption.encrypt(secret);
      mockPrisma.userMFA.findUnique.mockResolvedValue({
        userId: user.id,
        secret: encryptedSecret,
        enabled: true,
        backupCodes: [],
      });
      mockPrisma.user.findUnique.mockResolvedValue({
        passwordHash: bcrypt.hashSync(password, 10),
      });
    });

    it('should disable with correct password + valid code and log MFA_DISABLED', async () => {
      await service.disable(user, password, totpCode(secret));

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.userMFA.delete).toHaveBeenCalledWith({ where: { userId: user.id } });
      expect(mockPrisma.securityEvent.create.mock.calls[0][0].data.eventType).toBe('MFA_DISABLED');
    });

    it('should reject wrong password even with valid code', async () => {
      await expect(service.disable(user, 'errada', totpCode(secret))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject valid password with invalid code', async () => {
      await expect(service.disable(user, password, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should reject when MFA is not enabled', async () => {
      mockPrisma.userMFA.findUnique.mockResolvedValue(null);
      await expect(service.disable(user, password, '123456')).rejects.toThrow(BadRequestException);
    });
  });

  // ─── regenerateBackupCodes ─────────────────────────────────────────────────

  describe('regenerateBackupCodes', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    beforeEach(() => {
      const encryptedSecret = encryption.encrypt(secret);
      mockPrisma.userMFA.findUnique.mockResolvedValue({
        userId: user.id,
        secret: encryptedSecret,
        enabled: true,
        backupCodes: [],
      });
    });

    it('should regenerate 10 new codes with a valid TOTP code', async () => {
      const { backupCodes } = await service.regenerateBackupCodes(user, totpCode(secret));
      expect(backupCodes).toHaveLength(10);
      expect(mockPrisma.securityEvent.create.mock.calls[0][0].data.eventType).toBe(
        'MFA_BACKUP_CODES_REGENERATED',
      );
    });

    it('should reject with invalid code', async () => {
      await expect(service.regenerateBackupCodes(user, '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ─── roleRequiresMfa (enforcement suave) ───────────────────────────────────

  describe('roleRequiresMfa', () => {
    it('should return true when a vigent role assignment requires MFA', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1);
      expect(await service.roleRequiresMfa(user.id)).toBe(true);
      const where = mockPrisma.userRoleAssignment.count.mock.calls[0][0].where;
      expect(where.role).toEqual({ requireMfa: true, isActive: true });
    });

    it('should return false when no role requires MFA', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(0);
      expect(await service.roleRequiresMfa(user.id)).toBe(false);
    });

    it('should be best-effort: DB error → false (não derruba o login)', async () => {
      mockPrisma.userRoleAssignment.count.mockRejectedValue(new Error('db down'));
      expect(await service.roleRequiresMfa(user.id)).toBe(false);
    });
  });

  // ─── adminReset (#545) ───────────────────────────────────────────────────

  describe('adminReset (#545)', () => {
    const admin = { id: 'admin-1', companyId: 'company-1' };
    const ADMIN_PASS = 'S3nh@Admin';

    async function arrange({ targetInCompany = true, mfaEnabled = true } = {}) {
      const hash = await bcrypt.hash(ADMIN_PASS, 4);
      mockPrisma.user.findUnique.mockResolvedValue({ passwordHash: hash });
      mockPrisma.user.findFirst.mockResolvedValue(targetInCompany ? { id: 'user-1' } : null);
      mockPrisma.userMFA.findUnique.mockResolvedValue(mfaEnabled ? { enabled: true } : null);
    }

    it('reseta: deleta o UserMFA do ALVO + SecurityEvent com quem resetou (transação)', async () => {
      await arrange();

      await service.adminReset(admin, 'user-1', ADMIN_PASS);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.userMFA.delete).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
      expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          eventType: 'MFA_DISABLED',
          metadata: { resetByUserId: 'admin-1', reason: 'admin-reset' },
        }),
      });
    });

    it('nunca a própria conta (quatro olhos) → 400 sem tocar o banco', async () => {
      await expect(service.adminReset(admin, admin.id, ADMIN_PASS)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('senha do admin inválida → 401 (sessão roubada não reseta)', async () => {
      await arrange();
      await expect(service.adminReset(admin, 'user-1', 'errada')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('alvo de OUTRA empresa → 404 (anti-IDOR: escopo pelo companyId do admin)', async () => {
      await arrange({ targetInCompany: false });
      await expect(service.adminReset(admin, 'user-de-outra-empresa', ADMIN_PASS)).rejects.toThrow(
        'Usuário não encontrado nesta empresa.',
      );
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-de-outra-empresa', companyId: admin.companyId },
        }),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('alvo sem MFA habilitado → 400', async () => {
      await arrange({ mfaEnabled: false });
      await expect(service.adminReset(admin, 'user-1', ADMIN_PASS)).rejects.toThrow(
        'O usuário não tem MFA habilitado.',
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
