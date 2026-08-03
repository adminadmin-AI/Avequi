import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { UserService } from '../user/user.service';
import { TenantInviteService } from './tenant-invite.service';

/**
 * OPS WP2 (#909) — convite de primeiro acesso.
 * Contratos: usuário nasce via UserService.create (política #345 + RBAC v2
 * #738) com senha aleatória; token só existe em claro no e-mail (sha256 no
 * banco); reenvio revoga o anterior; aceite valida política e destrava;
 * mensagem de erro única (não revela se token existe/expirou/foi usado).
 */

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  tenantInvite: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  $transaction: jest.fn(),
};
const mockMail = { send: jest.fn() };
const mockUserService = { create: jest.fn() };
const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  recordPasswordChange: jest.fn(),
};
const mockConfig = { get: jest.fn().mockReturnValue('https://app.avecchi.ai') };

describe('TenantInviteService (OPS WP2 #909)', () => {
  let service: TenantInviteService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantInviteService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MailService, useValue: mockMail },
        { provide: UserService, useValue: mockUserService },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(TenantInviteService);
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('https://app.avecchi.ai');
    mockMail.send.mockResolvedValue({ ok: true });
    mockPrisma.tenantInvite.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.tenantInvite.create.mockResolvedValue({ id: 'inv-1' });
    mockPasswordPolicy.recordPasswordChange.mockResolvedValue(undefined);
  });

  describe('inviteAdmin', () => {
    it('usuário novo: cria via UserService (enum SUPER_ADMIN, mustChangePassword) e envia link com token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockUserService.create.mockResolvedValue({ id: 'u-1' });

      const result = await service.inviteAdmin(
        'tenant-1',
        { name: 'Maria', email: 'maria@crd.com.br' },
        'op-1',
      );

      expect(mockUserService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'maria@crd.com.br',
          role: UserRole.SUPER_ADMIN,
          mustChangePassword: true,
          password: expect.any(String),
        }),
        'tenant-1',
        'op-1',
      );
      // senha aleatória NUNCA vai no e-mail; o link leva o token
      const mailArgs = mockMail.send.mock.calls[0][0];
      const senha = mockUserService.create.mock.calls[0][0].password;
      expect(mailArgs.text).not.toContain(senha);
      expect(mailArgs.text).toContain('https://app.avecchi.ai/invite/accept?token=');
      // token em claro NÃO é o que foi pro banco (lá vai o sha256)
      const stored = mockPrisma.tenantInvite.create.mock.calls[0][0].data;
      expect(mailArgs.text).not.toContain(stored.tokenHash);
      expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.emailSent).toBe(true);
    });

    it('reconvite: revoga convites pendentes antes de emitir o novo', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', companyId: 'tenant-1' });

      await service.inviteAdmin('tenant-1', { name: 'Maria', email: 'maria@crd.com.br' }, 'op-1');

      expect(mockUserService.create).not.toHaveBeenCalled();
      expect(mockPrisma.tenantInvite.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u-1', usedAt: null, revokedAt: null },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    it('e-mail de usuário de OUTRO tenant → 400', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-9', companyId: 'outro-tenant' });
      await expect(
        service.inviteAdmin('tenant-1', { name: 'X', email: 'x@y.com' }, 'op-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.tenantInvite.create).not.toHaveBeenCalled();
    });

    it('SMTP fora: convite VALE mesmo assim (emailSent=false + reason)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'u-1', companyId: 'tenant-1' });
      mockMail.send.mockResolvedValue({ ok: false, reason: 'SMTP não configurado' });

      const result = await service.inviteAdmin(
        'tenant-1',
        { name: 'Maria', email: 'maria@crd.com.br' },
        'op-1',
      );
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toContain('SMTP');
      expect(mockPrisma.tenantInvite.create).toHaveBeenCalled();
    });
  });

  describe('acceptInvite', () => {
    const VALID_INVITE = {
      id: 'inv-1',
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3600_000),
      user: { id: 'u-1', name: 'Maria', email: 'maria@crd.com.br' },
    };

    it('token válido: aplica política, seta senha, marca usado e destrava (transação)', async () => {
      mockPrisma.tenantInvite.findUnique.mockResolvedValue(VALID_INVITE);
      mockPrisma.$transaction.mockResolvedValue([{}, {}]);

      const result = await service.acceptInvite('token-em-claro', 'Senha#Forte2026');

      expect(mockPasswordPolicy.validateComplexity).toHaveBeenCalledWith(
        'Senha#Forte2026',
        { email: 'maria@crd.com.br', name: 'Maria' },
      );
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPasswordPolicy.recordPasswordChange).toHaveBeenCalledWith(
        'u-1',
        null,
        expect.any(String),
      );
      expect(result).toEqual({ ok: true, email: 'maria@crd.com.br' });
    });

    it.each([
      ['inexistente', null],
      ['já usado', { ...VALID_INVITE, usedAt: new Date() }],
      ['revogado', { ...VALID_INVITE, revokedAt: new Date() }],
      ['expirado', { ...VALID_INVITE, expiresAt: new Date(Date.now() - 1000) }],
    ])('token %s → MESMA mensagem 400 (não revela o motivo)', async (_label, invite) => {
      mockPrisma.tenantInvite.findUnique.mockResolvedValue(invite);
      await expect(service.acceptInvite('tok', 'Senha#Forte2026')).rejects.toThrow(
        /Convite inválido ou expirado/,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('busca é pelo HASH do token, nunca pelo token em claro', async () => {
      mockPrisma.tenantInvite.findUnique.mockResolvedValue(null);
      await service.acceptInvite('token-em-claro', 'Senha#Forte2026').catch(() => undefined);
      const where = mockPrisma.tenantInvite.findUnique.mock.calls[0][0].where;
      expect(where.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(where.tokenHash).not.toBe('token-em-claro');
    });

    it('senha fora da política → erro da política, convite NÃO consumido', async () => {
      mockPrisma.tenantInvite.findUnique.mockResolvedValue(VALID_INVITE);
      mockPasswordPolicy.validateComplexity.mockImplementation(() => {
        throw new BadRequestException('Senha fraca');
      });
      await expect(service.acceptInvite('tok', 'fraca')).rejects.toThrow('Senha fraca');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
