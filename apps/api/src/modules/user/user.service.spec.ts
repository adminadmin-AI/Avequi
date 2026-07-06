import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from './user.service';

const mockPrisma = {
  user: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const SAFE_USER = {
  id: 'user-1',
  name: 'João',
  email: 'joao@gdr.com.br',
  role: 'MANAGER',
  isActive: true,
  companyId: 'co-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('create', () => {
    it('hasheia a senha com bcrypt e NUNCA persiste a senha em claro', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);

      await service.create({
        name: 'João',
        email: 'joao@gdr.com.br',
        password: 'senha123',
        role: 'MANAGER' as any,
        companyId: 'co-1',
      });

      const args = mockPrisma.user.create.mock.calls[0][0];
      // senha em claro nao pode ir para o banco em nenhum campo
      expect(args.data.password).toBeUndefined();
      expect(JSON.stringify(args.data)).not.toContain('senha123');
      // hash bcrypt valido e verificavel
      expect(args.data.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(bcrypt.compareSync('senha123', args.data.passwordHash)).toBe(true);
    });

    it('usa select seguro (sem passwordHash) na resposta', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);

      await service.create({
        name: 'João',
        email: 'joao@gdr.com.br',
        password: 'senha123',
        role: 'MANAGER' as any,
        companyId: 'co-1',
      });

      const args = mockPrisma.user.create.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.select.passwordHash).toBeUndefined();
      expect(args.select.id).toBe(true);
      expect(args.select.email).toBe(true);
    });
  });

  describe('findAll', () => {
    it('escopa por companyId para users comuns', async () => {
      mockPrisma.user.findMany.mockResolvedValue([SAFE_USER]);

      await service.findAll({ role: 'MANAGER', companyId: 'co-1' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: 'co-1' } }),
      );
    });

    it('SUPER_ADMIN enxerga todas as empresas (where vazio)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([SAFE_USER]);

      await service.findAll({ role: 'SUPER_ADMIN', companyId: 'co-1' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('nunca seleciona passwordHash na listagem', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ role: 'MANAGER', companyId: 'co-1' });

      const args = mockPrisma.user.findMany.mock.calls[0][0];
      expect(args.select.passwordHash).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('busca escopado por id + companyId (anti-IDOR)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(SAFE_USER);

      await service.findOne('user-1', 'co-1');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', companyId: 'co-1' },
        }),
      );
    });

    it('404 quando o user nao existe na empresa (cross-tenant)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', 'outra-co')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockPrisma.user.findFirst.mockResolvedValue(SAFE_USER);
      mockPrisma.user.update.mockResolvedValue(SAFE_USER);
    });

    it('re-hasheia a senha quando o update inclui password', async () => {
      await service.update('user-1', { password: 'NovaSenha@1' } as any, 'co-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      // senha em claro nao pode chegar ao banco
      expect(args.data.password).toBeUndefined();
      expect(JSON.stringify(args.data)).not.toContain('NovaSenha@1');
      // e o hash novo precisa corresponder a senha nova
      expect(args.data.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(bcrypt.compareSync('NovaSenha@1', args.data.passwordHash)).toBe(
        true,
      );
    });

    it('NAO toca no passwordHash quando o update nao envia password', async () => {
      await service.update('user-1', { name: 'Novo Nome' } as any, 'co-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.passwordHash).toBeUndefined();
      expect(args.data.password).toBeUndefined();
      expect(args.data.name).toBe('Novo Nome');
    });

    it('NAO toca no passwordHash quando password e string vazia', async () => {
      await service.update('user-1', { password: '' } as any, 'co-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.passwordHash).toBeUndefined();
    });

    it('valida escopo de empresa antes de atualizar (anti-IDOR)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', { name: 'X' } as any, 'outra-co'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('usa select seguro (sem passwordHash) na resposta do update', async () => {
      await service.update('user-1', { name: 'X' } as any, 'co-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.select.passwordHash).toBeUndefined();
    });
  });
});
