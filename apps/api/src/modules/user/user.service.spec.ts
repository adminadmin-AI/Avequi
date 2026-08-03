import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { UserService } from './user.service';

const mockPrisma = {
  user: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  userRoleAssignment: {
    count: jest.fn(),
  },
  role: {
    findFirst: jest.fn(),
  },
};

const mockSessionService = {
  revokeAllSessions: jest.fn().mockResolvedValue(0),
};

// OPS WP4 (#911): default ILIMITADO (tenant legado) — o limite de usuários
// tem testes próprios em user.service.user-limit.spec.ts.
const mockEntitlementService = {
  limit: jest.fn().mockResolvedValue(null),
};

// #468: mock do PasswordPolicyService (validação real coberta em
// user.service.password-policy.spec.ts). Aqui é no-op para não interferir
// nos testes de CRUD básico.
const mockPasswordPolicy = {
  validateComplexity: jest.fn(),
  assertNotReused: jest.fn().mockResolvedValue(undefined),
  recordPasswordChange: jest.fn().mockResolvedValue(undefined),
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
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: SessionService, useValue: mockSessionService },
        { provide: EntitlementService, useValue: mockEntitlementService },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe('create', () => {
    beforeEach(() => {
      // #738: por padrão o perfil system-espelho existe (companyId null).
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'role-gerente-geral' });
    });

    const baseDto = {
      name: 'João',
      email: 'joao@gdr.com.br',
      password: 'senha123',
      role: 'MANAGER' as any,
    };

    it('hasheia a senha com bcrypt e NUNCA persiste a senha em claro', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);

      await service.create({ ...baseDto }, 'co-1', 'admin-1');

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

      await service.create({ ...baseDto }, 'co-1', 'admin-1');

      const args = mockPrisma.user.create.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.select.passwordHash).toBeUndefined();
      expect(args.select.id).toBe(true);
      expect(args.select.email).toBe(true);
    });

    // ── #738: espelhamento automático enum → perfil v2 na criação ────────────

    it('cria o vínculo v2 do perfil-espelho JUNTO do usuário (nested write atômico)', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);

      await service.create({ ...baseDto, role: 'MANAGER' as any }, 'co-1', 'admin-1');

      // resolveu MANAGER → GERENTE_GERAL, perfil system global (companyId null)
      expect(mockPrisma.role.findFirst).toHaveBeenCalledWith({
        where: { code: 'GERENTE_GERAL', companyId: null },
        select: { id: true },
      });
      // vínculo criado no MESMO user.create (nested = 1 transação implícita)
      const args = mockPrisma.user.create.mock.calls[0][0];
      expect(args.data.roleAssignments.create).toEqual({
        roleId: 'role-gerente-geral',
        companyId: 'co-1', // escopo da empresa do usuário
        grantedBy: 'admin-1', // ator do JWT
      });
    });

    it('escreve o vínculo numa ÚNICA operação (não faz create separado de assignment)', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);

      await service.create({ ...baseDto }, 'co-1', 'admin-1');

      // atomicidade: nada é criado fora do user.create (nested write)
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.create.mock.calls[0][0].data.roleAssignments).toBeDefined();
    });

    it('espelha cada enum relevante no perfil system correto', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);
      const cases: Array<[string, string]> = [
        ['SUPER_ADMIN', 'ADMIN_GLOBAL'],
        ['DIRECTOR', 'DIRETOR'],
        ['MANAGER', 'GERENTE_GERAL'],
        ['STORE', 'LOJA_OPERACIONAL'],
      ];
      for (const [enumRole, systemCode] of cases) {
        jest.clearAllMocks();
        mockPrisma.role.findFirst.mockResolvedValue({ id: `role-${systemCode}` });
        mockPrisma.user.create.mockResolvedValue(SAFE_USER);
        await service.create({ ...baseDto, role: enumRole as any }, 'co-1', 'admin-1');
        expect(mockPrisma.role.findFirst).toHaveBeenCalledWith({
          where: { code: systemCode, companyId: null },
          select: { id: true },
        });
      }
    });

    it('grantedBy vem do ator (parâmetro), imune a qualquer coisa no corpo do dto', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);

      // mesmo se o dto trouxer lixo tentando forjar o concessor
      await service.create(
        { ...baseDto, grantedBy: 'forjado', actorId: 'forjado' } as any,
        'co-1',
        'admin-real',
      );

      expect(mockPrisma.user.create.mock.calls[0][0].data.roleAssignments.create.grantedBy).toBe(
        'admin-real',
      );
    });

    it('ENUM SEM MAPEAMENTO no catálogo → falha a criação inteira (nada criado)', async () => {
      await expect(
        service.create({ ...baseDto, role: 'PAPEL_INEXISTENTE' as any }, 'co-1', 'admin-1'),
      ).rejects.toThrow(/não tem perfil RBAC v2 correspondente/);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('PERFIL SYSTEM AUSENTE no banco → falha a criação inteira (nada criado)', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(
        service.create({ ...baseDto }, 'co-1', 'admin-1'),
      ).rejects.toThrow(/não encontrado/);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('a resolução do perfil acontece ANTES do create (sem usuário parcial se falha)', async () => {
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...baseDto }, 'co-1', 'admin-1')).rejects.toBeDefined();
      // password também não foi registrado no histórico (nada persistido)
      expect(mockPasswordPolicy.recordPasswordChange).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('criação normal NÃO depende de seed (resolve o perfil já existente no banco)', async () => {
      mockPrisma.user.create.mockResolvedValue(SAFE_USER);
      await service.create({ ...baseDto }, 'co-1', 'admin-1');
      // um único lookup de role + o create; nenhuma rotina de seed acionada
      expect(mockPrisma.role.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
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
      // Defaults das proteções: alvo NÃO é admin global; há 1 outro admin
      // ativo; revogação de sessões funciona. Cada teste sobrescreve o que
      // precisar — o beforeEach garante que um teste não vaza p/ o outro.
      mockPrisma.userRoleAssignment.count.mockResolvedValue(0);
      mockPrisma.user.count.mockResolvedValue(1);
      // WP7 (#914): a contagem de admins é escopada à ÁRVORE do tenant — o
      // service resolve a empresa do alvo via findUnique antes de contar.
      mockPrisma.user.findUnique.mockResolvedValue({
        company: { id: 'co-1', parentId: null },
      });
      mockSessionService.revokeAllSessions.mockResolvedValue(0);
    });

    it('re-hasheia a senha quando o update inclui password', async () => {
      await service.update('user-1', { password: 'NovaSenha@1' } as any, 'co-1', 'admin-1');

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
      await service.update('user-1', { name: 'Novo Nome' } as any, 'co-1', 'admin-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.passwordHash).toBeUndefined();
      expect(args.data.password).toBeUndefined();
      expect(args.data.name).toBe('Novo Nome');
    });

    it('NAO toca no passwordHash quando password e string vazia', async () => {
      await service.update('user-1', { password: '' } as any, 'co-1', 'admin-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.passwordHash).toBeUndefined();
    });

    it('inativa o usuário quando o update envia isActive=false (toggle da tela)', async () => {
      await service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(false);
      expect(args.data.passwordHash).toBeUndefined();
    });

    it('reativa o usuário quando o update envia isActive=true', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...SAFE_USER, isActive: false });
      await service.update('user-1', { isActive: true } as any, 'co-1', 'admin-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(true);
    });

    // ── Proteções da inativação (16/07/2026) ─────────────────────────────────

    it('AUTOINATIVAÇÃO: ator = alvo → 403 e NADA é persistido (nem outros campos)', async () => {
      await expect(
        service.update('user-1', { isActive: false, name: 'Hacker' } as any, 'co-1', 'user-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('autoedição SEM inativação (ex.: nome) segue permitida', async () => {
      await service.update('user-1', { name: 'Novo Nome' } as any, 'co-1', 'user-1');
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('ÚLTIMO ADMIN GLOBAL ativo: inativação rejeitada com 409, nada persistido', async () => {
      // alvo TEM vínculo ADMIN_GLOBAL efetivo; nenhum OUTRO admin ativo
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1);
      mockPrisma.user.count.mockResolvedValue(0);

      await expect(
        service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('admin global PODE ser inativado quando existe OUTRO admin global ativo', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1); // alvo é admin
      mockPrisma.user.count.mockResolvedValue(1); // e existe outro ativo

      await service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1');
      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(false);
    });

    it('WP7 (#914): a contagem de admins é escopada à ÁRVORE do tenant (matriz+filiais), nunca global', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1); // alvo é admin
      // alvo está numa FILIAL: raiz = parentId
      mockPrisma.user.findUnique.mockResolvedValue({
        company: { id: 'co-filial', parentId: 'co-raiz' },
      });

      await service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1');

      // O guard só conta admins DENTRO da árvore da raiz — admins de OUTROS
      // tenants não podem mais mascarar o "último admin" (bug multi-tenant).
      expect(mockPrisma.user.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            company: { OR: [{ id: 'co-raiz' }, { parentId: 'co-raiz' }] },
          }),
        }),
      );
    });

    it('WP7 (#914): tenant do alvo não resolvido → fail-closed (bloqueia como último admin)', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1); // alvo é admin
      mockPrisma.user.findUnique.mockResolvedValue(null); // empresa não resolvida

      await expect(
        service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.count).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('CORRIDA: pós-checagem zerou os admins → reverte a inativação e rejeita', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1); // alvo é admin
      // pré-checagem vê 1 outro admin; pós-checagem (após persistir) vê 0
      mockPrisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(
        service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1'),
      ).rejects.toThrow(ConflictException);
      // 1ª chamada inativou; 2ª chamada é a COMPENSAÇÃO (isActive: true)
      const calls = mockPrisma.user.update.mock.calls;
      expect(calls[0][0].data.isActive).toBe(false);
      expect(calls[1][0].data).toEqual({ isActive: true });
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('CORRIDA: compensação TAMBÉM falha → log crítico + erro ao cliente (nunca sucesso)', async () => {
      mockPrisma.userRoleAssignment.count.mockResolvedValue(1); // alvo é admin
      mockPrisma.user.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0); // corrida
      // 1ª chamada (inativação) funciona; 2ª (compensação) falha
      mockPrisma.user.update
        .mockResolvedValueOnce(SAFE_USER)
        .mockRejectedValueOnce(new Error('conexão caiu'));

      await expect(
        service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1'),
      ).rejects.toThrow(/Falha ao proteger o último administrador global/);
      // A compensação FOI tentada (2 updates) e a requisição NÃO retornou sucesso.
      expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('SESSÕES: inativar revoga TODAS as sessões do alvo (reason SECURITY)', async () => {
      await service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1');
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith('user-1', 'SECURITY');
    });

    it('SESSÕES: update comum (nome/papel) NÃO revoga nada', async () => {
      await service.update('user-1', { name: 'Novo Nome', role: 'MANAGER' } as any, 'co-1', 'admin-1');
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('SESSÕES: update que MANTÉM inativo não revoga de novo; reativar não restaura', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...SAFE_USER, isActive: false });

      await service.update('user-1', { isActive: false } as any, 'co-1', 'admin-1');
      await service.update('user-1', { isActive: true } as any, 'co-1', 'admin-1');
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('SESSÕES: falha na revogação NÃO desfaz a inativação (refresh já barra inativo #221)', async () => {
      mockSessionService.revokeAllSessions.mockRejectedValueOnce(new Error('redis fora'));

      const result = await service.update(
        'user-1',
        { isActive: false } as any,
        'co-1',
        'admin-1',
      );
      expect(result).toBeDefined();
      expect(mockPrisma.user.update.mock.calls[0][0].data.isActive).toBe(false);
    });

    it('valida escopo de empresa antes de atualizar (anti-IDOR)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', { name: 'X' } as any, 'outra-co', 'admin-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('usa select seguro (sem passwordHash) na resposta do update', async () => {
      await service.update('user-1', { name: 'X' } as any, 'co-1', 'admin-1');

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.select.passwordHash).toBeUndefined();
    });
  });
});
