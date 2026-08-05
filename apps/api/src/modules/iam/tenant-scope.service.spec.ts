import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CROSS_COMPANY_PERMISSION, TenantScopeService } from './tenant-scope.service';

/**
 * #947 — a capability de escopo empresarial.
 *
 * O que estes testes protegem, em uma frase: **ninguém atravessa empresa sem
 * um perfil ESTRUTURAL que conceda a capability**, e mesmo quem atravessa só
 * enxerga o próprio grupo.
 */
describe('TenantScopeService (#947)', () => {
  let service: TenantScopeService;
  let prisma: any;

  /** Perfil estrutural (do catálogo): isSystem + companyId null. */
  const ADMIN_GLOBAL = { id: 'r-adm-global', parentId: null, rolePermissions: [{ granted: true }] };

  beforeEach(async () => {
    prisma = {
      userPermission: { findFirst: jest.fn().mockResolvedValue(null) },
      userRoleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      role: { findMany: jest.fn().mockResolvedValue([]) },
      company: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TenantScopeService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(TenantScopeService);
  });

  /** Atalho: usuário COM perfil estrutural que concede a capability. */
  function comPerfilEstrutural() {
    prisma.userRoleAssignment.findMany.mockResolvedValue([{ roleId: ADMIN_GLOBAL.id }]);
    prisma.role.findMany.mockResolvedValue([ADMIN_GLOBAL]);
  }

  describe('podeAmpliar — quem concede', () => {
    it('perfil estrutural com a capability → amplia', async () => {
      comPerfilEstrutural();
      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(true);
    });

    it('sem perfil estrutural nenhum → NÃO amplia', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);
      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
    });

    it('perfil estrutural SEM a capability (ADMIN_EMPRESA, DIRETOR) → NÃO amplia', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([{ roleId: 'r-adm-empresa' }]);
      // o perfil existe e é estrutural, mas não tem vínculo com esta permissão
      prisma.role.findMany.mockResolvedValue([
        { id: 'r-adm-empresa', parentId: null, rolePermissions: [] },
      ]);
      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
    });

    it('a consulta de assignments EXIGE perfil estrutural (isSystem + companyId null)', async () => {
      comPerfilEstrutural();
      await service.podeAmpliar('u1', 'c1');

      const where = prisma.userRoleAssignment.findMany.mock.calls[0][0].where;
      expect(where.role).toMatchObject({ isActive: true, isSystem: true, companyId: null });
    });
  });

  describe('podeAmpliar — a trava contra escalada de tenant', () => {
    it('perfil CUSTOMIZADO de tenant com o mesmo código NÃO atravessa empresas', async () => {
      // O admin da empresa criou um perfil próprio e deu a si mesmo a permissão.
      // O filtro do banco (companyId null) já o exclui: nada é devolvido.
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);
      prisma.role.findMany.mockResolvedValue([
        { id: 'r-custom', parentId: null, rolePermissions: [{ granted: true }] },
      ]);

      await expect(service.podeAmpliar('u-esperto', 'c1')).resolves.toBe(false);
    });

    it('herança que passa por perfil de empresa morre no ramo', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([{ roleId: 'r-sys-filho' }]);
      prisma.role.findMany
        // nível 0: perfil estrutural sem a permissão, mas com pai
        .mockResolvedValueOnce([{ id: 'r-sys-filho', parentId: 'r-custom-pai', rolePermissions: [] }])
        // nível 1: o pai é customizado → o filtro do banco não o devolve
        .mockResolvedValueOnce([]);

      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
    });

    it('grant INDIVIDUAL não concede — a capability é estrutural', async () => {
      // sem assignment estrutural; só um UserPermission granted
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);
      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
      // e o método nem chega a consultar grants individuais como fonte
      expect(prisma.userPermission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ granted: false }) }),
      );
    });

    it('deny INDIVIDUAL vence o perfil estrutural', async () => {
      comPerfilEstrutural();
      prisma.userPermission.findFirst.mockResolvedValue({ id: 'up-deny' });

      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
    });

    it('deny NO PERFIL vence o grant do perfil', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([{ roleId: 'r1' }]);
      prisma.role.findMany.mockResolvedValue([
        { id: 'r1', parentId: null, rolePermissions: [{ granted: false }] },
      ]);

      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
    });
  });

  describe('podeAmpliar — fail-closed', () => {
    it('erro de banco NUNCA amplia', async () => {
      prisma.userPermission.findFirst.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(service.podeAmpliar('u1', 'c1')).resolves.toBe(false);
    });

    it('resolverEscopo com erro devolve só a própria empresa', async () => {
      prisma.userRoleAssignment.findMany.mockRejectedValue(new Error('db down'));
      await expect(service.resolverEscopo('u1', 'c1')).resolves.toEqual({
        companyIds: ['c1'],
        ampliado: false,
      });
    });
  });

  describe('resolverEscopo — o alvo da ampliação é o GRUPO', () => {
    it('sem capability: só a própria empresa, e o filtro nunca some', async () => {
      prisma.userRoleAssignment.findMany.mockResolvedValue([]);
      const escopo = await service.resolverEscopo('u1', 'c-filial');

      expect(escopo).toEqual({ companyIds: ['c-filial'], ampliado: false });
      expect(prisma.company.findMany).not.toHaveBeenCalled();
    });

    it('com capability: raiz + filiais — NÃO "todas as empresas do banco"', async () => {
      comPerfilEstrutural();
      prisma.company.findUnique.mockResolvedValue({ parentId: null }); // c-raiz é raiz
      prisma.company.findMany.mockResolvedValue([{ id: 'c-fil-1' }, { id: 'c-fil-2' }]);

      const escopo = await service.resolverEscopo('u1', 'c-raiz');

      expect(escopo.ampliado).toBe(true);
      expect(escopo.companyIds.sort()).toEqual(['c-fil-1', 'c-fil-2', 'c-raiz']);
      // a busca de filiais é ANCORADA na raiz — nunca um findMany sem where
      expect(prisma.company.findMany).toHaveBeenCalledWith({
        where: { parentId: 'c-raiz' },
        select: { id: true },
      });
    });

    it('quem consulta de uma FILIAL sobe até a raiz e vê o mesmo grupo', async () => {
      comPerfilEstrutural();
      prisma.company.findUnique
        .mockResolvedValueOnce({ parentId: 'c-raiz' }) // c-filial → sobe
        .mockResolvedValueOnce({ parentId: null }); // c-raiz é a raiz
      prisma.company.findMany.mockResolvedValue([{ id: 'c-filial' }, { id: 'c-outra' }]);

      const escopo = await service.resolverEscopo('u1', 'c-filial');

      expect(escopo.companyIds.sort()).toEqual(['c-filial', 'c-outra', 'c-raiz']);
    });

    it('empresa de OUTRO grupo não entra no escopo', async () => {
      comPerfilEstrutural();
      prisma.company.findUnique.mockResolvedValue({ parentId: null });
      prisma.company.findMany.mockResolvedValue([{ id: 'c-fil-1' }]);

      const escopo = await service.resolverEscopo('u1', 'c-raiz');

      expect(escopo.companyIds).not.toContain('c-de-outro-tenant');
    });

    it('ciclo na árvore → fail-closed (só a própria empresa)', async () => {
      comPerfilEstrutural();
      // c-a → c-b → c-a
      prisma.company.findUnique
        .mockResolvedValueOnce({ parentId: 'c-b' })
        .mockResolvedValueOnce({ parentId: 'c-a' });

      const escopo = await service.resolverEscopo('u1', 'c-a');
      expect(escopo.companyIds).toEqual(['c-a']);
    });

    it('árvore funda demais → fail-closed', async () => {
      comPerfilEstrutural();
      let n = 0;
      prisma.company.findUnique.mockImplementation(() =>
        Promise.resolve({ parentId: `c-${++n}` }),
      );

      const escopo = await service.resolverEscopo('u1', 'c-0');
      expect(escopo.companyIds).toEqual(['c-0']);
    });
  });

  it('a constante da permissão é a do catálogo', () => {
    expect(CROSS_COMPANY_PERMISSION).toBe('iam.tenant-scope.cross-company');
  });
});
