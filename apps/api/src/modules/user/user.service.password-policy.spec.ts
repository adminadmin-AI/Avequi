import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { UserService } from './user.service';

const mockPrisma = {
  user: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  userRoleAssignment: { count: jest.fn() },
  role: { findFirst: jest.fn() },
};

const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  assertNotReused: jest.fn(),
  recordPasswordChange: jest.fn(),
  getMaxAgeDays: jest.fn(),
  isPasswordExpired: jest.fn(),
  getPolicy: jest.fn(),
};

const createdUser = {
  id: 'user-novo',
  name: 'João Silva',
  email: 'joao@gdr.com.br',
  role: 'STORE',
  isActive: true,
  companyId: 'company-1',
  mustChangePassword: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UserService — política de senha no create/update pelo admin (#345)', () => {
  let service: UserService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: SessionService, useValue: { revokeAllSessions: jest.fn().mockResolvedValue(0) } },
      ],
    }).compile();

    service = module.get(UserService);
    jest.clearAllMocks();
    mockPasswordPolicy.validateComplexity.mockReturnValue(undefined);
    mockPasswordPolicy.assertNotReused.mockResolvedValue(undefined);
    mockPasswordPolicy.recordPasswordChange.mockResolvedValue(undefined);
    mockPrisma.user.create.mockResolvedValue(createdUser);
    mockPrisma.user.findFirst.mockResolvedValue(createdUser);
    mockPrisma.user.findUnique.mockResolvedValue({ passwordHash: 'hash-antigo' });
    mockPrisma.user.update.mockResolvedValue(createdUser);
    mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-loja-op' }); // #738 perfil-espelho existe
  });

  describe('create', () => {
    const dto: any = {
      name: 'João Silva',
      email: 'joao@gdr.com.br',
      password: 'SenhaForte#2026',
      role: 'STORE',
      companyId: 'company-1',
    };

    it('aplica a política de complexidade com o contexto do NOVO usuário', async () => {
      await service.create(dto, 'company-1', 'admin-1');

      expect(mockPasswordPolicy.validateComplexity).toHaveBeenCalledWith('SenhaForte#2026', {
        email: 'joao@gdr.com.br',
        name: 'João Silva',
      });
    });

    it('senha fora da política → BadRequest e usuário NÃO é criado', async () => {
      mockPasswordPolicy.validateComplexity.mockImplementation(() => {
        throw new BadRequestException(['A senha deve ter no mínimo 10 caracteres.']);
      });

      await expect(service.create({ ...dto, password: 'fraca' }, 'company-1', 'admin-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('marca passwordChangedAt na criação e semeia o histórico com o hash inicial', async () => {
      await service.create(dto, 'company-1', 'admin-1');

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordChangedAt: expect.any(Date) }),
        }),
      );
      expect(mockPasswordPolicy.recordPasswordChange).toHaveBeenCalledWith(
        'user-novo',
        null,
        expect.any(String),
      );
    });

    it('admin pode criar com mustChangePassword=true (troca forçada no 1º login)', async () => {
      await service.create({ ...dto, mustChangePassword: true }, 'company-1', 'admin-1');

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });

    it('#468: sem a flag, admin-create já força a troca (mustChangePassword=true por padrão)', async () => {
      await service.create(dto, 'company-1', 'admin-1'); // dto NÃO traz mustChangePassword

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });

    it('#468: admin pode desativar explicitamente com mustChangePassword=false', async () => {
      await service.create({ ...dto, mustChangePassword: false }, 'company-1', 'admin-1');

      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: false }),
        }),
      );
    });
  });

  describe('update (reset de senha pelo admin)', () => {
    it('aplica complexidade + bloqueio de reuso antes de trocar', async () => {
      await service.update('user-novo', { password: 'NovaSenha#2026x' } as any, 'company-1', 'admin-1');

      expect(mockPasswordPolicy.validateComplexity).toHaveBeenCalledWith('NovaSenha#2026x', {
        email: createdUser.email,
        name: createdUser.name,
      });
      expect(mockPasswordPolicy.assertNotReused).toHaveBeenCalledWith(
        'user-novo',
        'NovaSenha#2026x',
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordHash: expect.any(String),
            passwordChangedAt: expect.any(Date),
          }),
        }),
      );
      // Histórico com o hash ANTERIOR (buscado antes do update) + novo.
      expect(mockPasswordPolicy.recordPasswordChange).toHaveBeenCalledWith(
        'user-novo',
        'hash-antigo',
        expect.any(String),
      );
    });

    it('reuso de senha antiga → BadRequest e senha NÃO troca', async () => {
      mockPasswordPolicy.assertNotReused.mockRejectedValue(
        new BadRequestException(
          'A nova senha não pode ser igual a nenhuma das últimas 5 senhas utilizadas.',
        ),
      );

      await expect(
        service.update('user-novo', { password: 'Repetida#2026x' } as any, 'company-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('admin pode setar mustChangePassword=true no reset (troca forçada no próximo login)', async () => {
      await service.update(
        'user-novo',
        { password: 'NovaSenha#2026x', mustChangePassword: true } as any,
        'company-1',
        'admin-1',
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });

    it('#468: reset por admin SEM a flag já força a troca (mustChangePassword=true por padrão)', async () => {
      await service.update('user-novo', { password: 'NovaSenha#2026x' } as any, 'company-1', 'admin-1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mustChangePassword: true }),
        }),
      );
    });

    it('update SEM senha não toca na política nem nos campos de senha', async () => {
      await service.update('user-novo', { name: 'Novo Nome' } as any, 'company-1', 'admin-1');

      expect(mockPasswordPolicy.validateComplexity).not.toHaveBeenCalled();
      expect(mockPasswordPolicy.assertNotReused).not.toHaveBeenCalled();
      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('passwordHash');
      expect(data).not.toHaveProperty('passwordChangedAt');
    });
  });
});
