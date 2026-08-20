import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { SessionService } from '../iam/session.service';
import { LastAdminInvariantService } from '../iam/last-admin-invariant.service';
import { TenantScopeService } from '../iam/tenant-scope.service';
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
  userUiPreference: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
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

// #947: escopo empresarial resolvido por capability, não pelo enum.
const mockTenantScope = {
  resolverEscopo: jest.fn(),
};

const mockLastAdmin = {
  temVinculoAdminPerpetuo: jest.fn().mockResolvedValue(false),
  ehAdminGlobalEfetivo: jest.fn().mockResolvedValue(false),
  // Default: executa a operação passando o mockPrisma como tx (caminho feliz).
  executarProtegido: jest.fn(async (_companyId: string, op: any) => op(mockPrisma)),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // padrão: sem ampliação — só a própria empresa
    mockTenantScope.resolverEscopo.mockImplementation((_u: string, companyId: string) =>
      Promise.resolve({ companyIds: [companyId], ampliado: false }),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PasswordPolicyService, useValue: mockPasswordPolicy },
        { provide: SessionService, useValue: mockSessionService },
        { provide: EntitlementService, useValue: mockEntitlementService },
        { provide: LastAdminInvariantService, useValue: mockLastAdmin },
        { provide: TenantScopeService, useValue: mockTenantScope },
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

  describe('preferencias de UI (#975)', () => {
    it('sem linha no banco devolve estado zero (arrays vazios), nao erro', async () => {
      mockPrisma.userUiPreference.findUnique.mockResolvedValue(null);

      const result = await service.getUiPreferences({ id: 'user-1' });

      expect(mockPrisma.userUiPreference.findUnique).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result).toEqual({ favorites: [], collapsedSections: [] });
    });

    it('com linha devolve os arrays persistidos', async () => {
      mockPrisma.userUiPreference.findUnique.mockResolvedValue({
        favorites: ['/sales', '/crm'],
        collapsedSections: ['fiscal'],
      });

      const result = await service.getUiPreferences({ id: 'user-1' });

      expect(result).toEqual({
        favorites: ['/sales', '/crm'],
        collapsedSections: ['fiscal'],
      });
    });

    it('upsert escopado pelo userId do JWT, com companyId do JWT no create', async () => {
      mockPrisma.userUiPreference.upsert.mockResolvedValue({
        favorites: ['/crm'],
        collapsedSections: [],
      });

      const result = await service.saveUiPreferences(
        { id: 'user-1', companyId: 'co-1' },
        { favorites: ['/crm'], collapsedSections: [] },
      );

      expect(mockPrisma.userUiPreference.upsert).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        create: {
          userId: 'user-1',
          companyId: 'co-1',
          favorites: ['/crm'],
          collapsedSections: [],
        },
        update: { favorites: ['/crm'], collapsedSections: [] },
      });
      expect(result).toEqual({ favorites: ['/crm'], collapsedSections: [] });
    });
  });

  describe('findAll', () => {
    it('escopa por companyId para users comuns', async () => {
      mockPrisma.user.findMany.mockResolvedValue([SAFE_USER]);

      await service.findAll({ id: 'u-1', companyId: 'co-1' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: { in: ['co-1'] } } }),
      );
    });

    it('#947: com a capability enxerga o GRUPO — e o filtro NUNCA vira where vazio', async () => {
      mockPrisma.user.findMany.mockResolvedValue([SAFE_USER]);
      mockTenantScope.resolverEscopo.mockResolvedValue({
        companyIds: ['co-1', 'co-1-filial'],
        ampliado: true,
      });

      await service.findAll({ id: 'u-admin', companyId: 'co-1' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: { in: ['co-1', 'co-1-filial'] } } }),
      );
      // a regressão que este teste pega: voltar a `where: {}` (todos os tenants)
      const arg = mockPrisma.user.findMany.mock.calls[0][0];
      expect(arg.where.companyId).toBeDefined();
    });

    it('#947: o ENUM sozinho não amplia mais nada', async () => {
      mockPrisma.user.findMany.mockResolvedValue([SAFE_USER]);
      // sem capability, mesmo que o usuário fosse SUPER_ADMIN no enum
      mockTenantScope.resolverEscopo.mockResolvedValue({
        companyIds: ['co-1'],
        ampliado: false,
      });

      await service.findAll({ id: 'u-legado', companyId: 'co-1' });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { companyId: { in: ['co-1'] } } }),
      );
    });

    it('nunca seleciona passwordHash na listagem', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.findAll({ id: 'u-1', companyId: 'co-1' });

      const args = mockPrisma.user.findMany.mock.calls[0][0];
      expect(args.select.passwordHash).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('busca escopada por id + escopo empresarial (anti-IDOR)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(SAFE_USER);

      await service.findOne('user-1', { id: 'ator-1', companyId: 'co-1' });

      // #1107: o filtro deixou de ser um companyId cru e passou a ser a lista
      // FECHADA devolvida pelo TenantScopeService. Sem a capability essa lista
      // é `['co-1']` — mesmo recorte de antes, agora vindo de uma única fonte.
      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', companyId: { in: ['co-1'] } },
        }),
      );
      // A trava que importa: NUNCA pode virar consulta sem escopo de empresa.
      const arg = mockPrisma.user.findFirst.mock.calls[0][0];
      expect(arg.where.companyId).toBeDefined();
    });

    it('404 quando o user nao existe na empresa (cross-tenant)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(service.findOne('user-1', { id: 'ator-1', companyId: 'outra-co' })).rejects.toThrow(
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
      // #752: default = alvo NÃO conta na invariante; mecanismo central no
      // caminho feliz (executa a operação e devolve o resultado).
      mockLastAdmin.temVinculoAdminPerpetuo.mockResolvedValue(false);
      mockLastAdmin.executarProtegido.mockImplementation(
        async (_companyId: string, op: any) => op(mockPrisma),
      );
      mockSessionService.revokeAllSessions.mockResolvedValue(0);
    });

    it('re-hasheia a senha quando o update inclui password', async () => {
      await service.update('user-1', { password: 'NovaSenha@1' } as any, { id: 'admin-1', companyId: 'co-1' });

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
      await service.update('user-1', { name: 'Novo Nome' } as any, { id: 'admin-1', companyId: 'co-1' });

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.passwordHash).toBeUndefined();
      expect(args.data.password).toBeUndefined();
      expect(args.data.name).toBe('Novo Nome');
    });

    it('NAO toca no passwordHash quando password e string vazia', async () => {
      await service.update('user-1', { password: '' } as any, { id: 'admin-1', companyId: 'co-1' });

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.passwordHash).toBeUndefined();
    });

    it('inativa o usuário quando o update envia isActive=false (toggle da tela)', async () => {
      await service.update('user-1', { isActive: false } as any, { id: 'admin-1', companyId: 'co-1' });

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(false);
      expect(args.data.passwordHash).toBeUndefined();
    });

    it('reativa o usuário quando o update envia isActive=true', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...SAFE_USER, isActive: false });
      await service.update('user-1', { isActive: true } as any, { id: 'admin-1', companyId: 'co-1' });

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(true);
    });

    // ── Proteções da inativação (16/07/2026) ─────────────────────────────────

    it('AUTOINATIVAÇÃO: ator = alvo → 403 e NADA é persistido (nem outros campos)', async () => {
      await expect(
        service.update('user-1', { isActive: false, name: 'Hacker' } as any, { id: 'user-1', companyId: 'co-1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('autoedição SEM inativação (ex.: nome) segue permitida', async () => {
      await service.update('user-1', { name: 'Novo Nome' } as any, { id: 'user-1', companyId: 'co-1' });
      expect(mockPrisma.user.update).toHaveBeenCalled();
    });

    it('#752: alvo com vínculo ADMIN_GLOBAL perpétuo → inativação roda no mecanismo central (lock)', async () => {
      mockLastAdmin.temVinculoAdminPerpetuo.mockResolvedValue(true);

      await service.update('user-1', { isActive: false } as any, { id: 'admin-1', companyId: 'co-1' });

      expect(mockLastAdmin.executarProtegido).toHaveBeenCalledWith('co-1', expect.any(Function));
      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(false);
    });

    it('#752: mecanismo central rejeita (último admin) → 409 propaga, sessões intactas', async () => {
      mockLastAdmin.temVinculoAdminPerpetuo.mockResolvedValue(true);
      mockLastAdmin.executarProtegido.mockRejectedValue(
        new ConflictException('Não é possível concluir a operação'),
      );

      await expect(
        service.update('user-1', { isActive: false } as any, { id: 'admin-1', companyId: 'co-1' }),
      ).rejects.toThrow(ConflictException);
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('#752: alvo que NÃO conta na invariante inativa direto, sem lock', async () => {
      mockLastAdmin.temVinculoAdminPerpetuo.mockResolvedValue(false);

      await service.update('user-1', { isActive: false } as any, { id: 'admin-1', companyId: 'co-1' });

      expect(mockLastAdmin.executarProtegido).not.toHaveBeenCalled();
      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.data.isActive).toBe(false);
    });

    it('SESSÕES: inativar revoga TODAS as sessões do alvo (reason SECURITY)', async () => {
      await service.update('user-1', { isActive: false } as any, { id: 'admin-1', companyId: 'co-1' });
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith('user-1', 'SECURITY');
    });

    it('SESSÕES: update comum (nome/papel) NÃO revoga nada', async () => {
      await service.update('user-1', { name: 'Novo Nome', role: 'MANAGER' } as any, { id: 'admin-1', companyId: 'co-1' });
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('SESSÕES: update que MANTÉM inativo não revoga de novo; reativar não restaura', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...SAFE_USER, isActive: false });

      await service.update('user-1', { isActive: false } as any, { id: 'admin-1', companyId: 'co-1' });
      await service.update('user-1', { isActive: true } as any, { id: 'admin-1', companyId: 'co-1' });
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('SESSÕES: falha na revogação NÃO desfaz a inativação (refresh já barra inativo #221)', async () => {
      mockSessionService.revokeAllSessions.mockRejectedValueOnce(new Error('redis fora'));

      const result = await service.update(
        'user-1',
        { isActive: false } as any,
        { id: 'admin-1', companyId: 'co-1' },
      );
      expect(result).toBeDefined();
      expect(mockPrisma.user.update.mock.calls[0][0].data.isActive).toBe(false);
    });

    it('valida escopo de empresa antes de atualizar (anti-IDOR)', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.update('user-1', { name: 'X' } as any, { id: 'admin-1', companyId: 'outra-co' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('usa select seguro (sem passwordHash) na resposta do update', async () => {
      await service.update('user-1', { name: 'X' } as any, { id: 'admin-1', companyId: 'co-1' });

      const args = mockPrisma.user.update.mock.calls[0][0];
      expect(args.select).toBeDefined();
      expect(args.select.passwordHash).toBeUndefined();
    });
  });
});
