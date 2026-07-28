import { BadRequestException, NotFoundException } from '@nestjs/common';
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

const mockSessionService = {
  revokeAllSessions: jest.fn(),
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
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();

    service = module.get(UserService);
    jest.clearAllMocks();
    mockSessionService.revokeAllSessions.mockResolvedValue(0);
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

  // ─── #750: reset por admin revoga as sessões do ALVO ─────────────────────
  describe('update (reset de senha pelo admin) — revogação de sessões (#750)', () => {
    it('revoga TODAS as sessões do usuário-alvo com reason SECURITY (nunca as do ator)', async () => {
      await service.update('user-novo', { password: 'NovaSenha#2026x' } as any, 'company-1', 'admin-1');

      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledTimes(1);
      // Alvo = usuário redefinido; SEM exceptSessionId (todas caem, denylist
      // mata os access tokens). O ator ('admin-1') nunca entra aqui.
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith('user-novo', 'SECURITY');
    });

    it('update SEM senha não revoga sessão nenhuma', async () => {
      await service.update('user-novo', { name: 'Novo Nome' } as any, 'company-1', 'admin-1');

      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('senha fora da política → nada persiste e nada é revogado', async () => {
      mockPasswordPolicy.validateComplexity.mockImplementation(() => {
        throw new BadRequestException(['A senha deve ter no mínimo 10 caracteres.']);
      });

      await expect(
        service.update('user-novo', { password: 'fraca' } as any, 'company-1', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('usuário de outra empresa → NotFound, sem troca e sem revogação', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null); // findOne escopado por companyId

      await expect(
        service.update('user-outra-cia', { password: 'NovaSenha#2026x' } as any, 'company-1', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('falha na revogação segue a política do #744: troca NÃO desfeita, erro estruturado SEM a senha', async () => {
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();
      mockSessionService.revokeAllSessions.mockRejectedValueOnce(new Error('redis fora'));

      const result = await service.update(
        'user-novo',
        { password: 'NovaSenha#2026x' } as any,
        'company-1',
        'admin-1',
      );

      // A troca persiste e a chamada retorna sucesso (não há como "destrocar"
      // com segurança; o refresh barrado por mustChangePassword limita o
      // resíduo à vida do access token).
      expect(result).toEqual(createdUser);
      expect(mockPrisma.user.update).toHaveBeenCalled();
      // Log estruturado, nível error, com IDs técnicos — e NUNCA a senha.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0] as string;
      expect(logged).toContain('user_password_reset_session_revoke_failed');
      expect(logged).toContain('user-novo');
      expect(logged).toContain('admin-1');
      expect(logged).not.toContain('NovaSenha#2026x');
      errorSpy.mockRestore();
    });

    it('reset em usuário inativo não reativa (payload não toca isActive)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...createdUser, isActive: false });

      await service.update('user-novo', { password: 'NovaSenha#2026x' } as any, 'company-1', 'admin-1');

      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('isActive');
    });

    it('nenhuma senha em claro chega ao banco nem aos logs no caminho feliz', async () => {
      const errorSpy = jest.spyOn((service as any).logger, 'error').mockImplementation();
      const warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation();

      await service.update('user-novo', { password: 'NovaSenha#2026x' } as any, 'company-1', 'admin-1');

      // Banco recebe HASH (nunca o texto puro).
      const data = mockPrisma.user.update.mock.calls[0][0].data;
      expect(data.passwordHash).toBeDefined();
      expect(data.passwordHash).not.toBe('NovaSenha#2026x');
      expect(data).not.toHaveProperty('password');
      // Nenhum log no caminho feliz — muito menos com a senha.
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
