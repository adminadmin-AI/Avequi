import { Test, TestingModule } from '@nestjs/testing';
import { CompanyGroupService } from './company-group.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * #1119 — resolução do grupo econômico (lado leitura).
 *
 * A pergunta que este serviço responde decide quem consegue trabalhar em qual
 * empresa. As três propriedades que os testes travam:
 *
 *  - **sem grupo declarado, nada muda**: o "grupo" é o próprio tenant. É o
 *    estado de todos os tenants que nunca vão ter grupo nenhum;
 *  - **estar no grupo não dá acesso**: o grupo torna o acesso concedível; quem
 *    abre a porta é o vínculo de perfil. Grupo sem vínculo = zero;
 *  - **fail-closed**: banco fora devolve o recorte mínimo, nunca uma lista
 *    ampliada.
 */

const GDR = 'gdr';
const GUARAPUAVA = 'gdr-guarapuava';
const CRD = 'crd';
const GRUPO = 'grupo-1';

const mockPrisma = {
  company: { findUnique: jest.fn(), findMany: jest.fn() },
  userRoleAssignment: { findMany: jest.fn() },
};

describe('CompanyGroupService (#1119)', () => {
  let service: CompanyGroupService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CompanyGroupService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(CompanyGroupService);
    jest.clearAllMocks();
  });

  describe('empresasDoGrupo', () => {
    it('sem grupo declarado: o grupo é o próprio tenant (raiz + filiais)', async () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: GDR, parentId: null }) // raizDe
        .mockResolvedValueOnce({ groupId: null }); // sem grupo
      mockPrisma.company.findMany.mockResolvedValue([{ id: GUARAPUAVA }]);

      expect(await service.empresasDoGrupo(GDR)).toEqual([GDR, GUARAPUAVA]);
    });

    it('com grupo: junta as raízes declaradas E as filiais de cada uma', async () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: GDR, parentId: null })
        .mockResolvedValueOnce({ groupId: GRUPO });
      mockPrisma.company.findMany
        .mockResolvedValueOnce([{ id: GDR }, { id: CRD }]) // raízes do grupo
        .mockResolvedValueOnce([{ id: GUARAPUAVA }]); // filiais delas

      const empresas = await service.empresasDoGrupo(GDR);

      expect(empresas.sort()).toEqual([CRD, GDR, GUARAPUAVA].sort());
    });

    it('perguntando a partir de uma FILIAL, o grupo é o da matriz', async () => {
      // O grupo é declarado na raiz; quem trabalha na filial pertence ao mesmo.
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: GUARAPUAVA, parentId: GDR }) // raizDe → GDR
        .mockResolvedValueOnce({ groupId: GRUPO });
      mockPrisma.company.findMany
        .mockResolvedValueOnce([{ id: GDR }, { id: CRD }])
        .mockResolvedValueOnce([{ id: GUARAPUAVA }]);

      expect(await service.empresasDoGrupo(GUARAPUAVA)).toContain(CRD);
      expect(mockPrisma.company.findUnique).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ where: { id: GDR } }),
      );
    });

    it('banco fora → só a própria empresa (fail-closed, nunca amplia)', async () => {
      mockPrisma.company.findUnique.mockRejectedValue(new Error('connection reset'));

      expect(await service.empresasDoGrupo(GDR)).toEqual([GDR]);
    });
  });

  describe('empresasDoUsuario', () => {
    const semGrupo = () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: GDR, parentId: null })
        .mockResolvedValueOnce({ groupId: null });
      mockPrisma.company.findMany.mockResolvedValue([]);
    };

    const comGrupo = () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: GDR, parentId: null })
        .mockResolvedValueOnce({ groupId: GRUPO });
      mockPrisma.company.findMany
        .mockResolvedValueOnce([{ id: GDR }, { id: CRD }])
        .mockResolvedValueOnce([]);
    };

    it('a empresa de cadastro entra SEMPRE, mesmo sem vínculo v2', async () => {
      // Tirá-la trancaria para fora quem ainda não tem RBAC v2 nenhum.
      semGrupo();
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);

      expect(await service.empresasDoUsuario('u1', GDR)).toEqual([GDR]);
    });

    it('vínculo em empresa do grupo → entra na lista', async () => {
      comGrupo();
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([{ companyId: CRD }]);

      expect(await service.empresasDoUsuario('u1', GDR).then((l) => l.sort())).toEqual(
        [CRD, GDR].sort(),
      );
    });

    it('vínculo FORA do grupo é descartado — grupo e vínculo têm de coincidir', async () => {
      // Cenário real: o grupo foi desfeito e a limpeza dos vínculos falhou no
      // meio. Conferir os dois eixos faz a desassociação valer na hora.
      comGrupo();
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([
        { companyId: 'empresa-de-outro-cliente' },
      ]);

      expect(await service.empresasDoUsuario('u1', GDR)).toEqual([GDR]);
    });

    it('vínculo EXPIRADO não conta', async () => {
      comGrupo();
      mockPrisma.userRoleAssignment.findMany.mockResolvedValue([]);

      await service.empresasDoUsuario('u1', GDR);

      // A consulta já filtra expiração e perfil inativo no banco.
      const where = mockPrisma.userRoleAssignment.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { expiresAt: null },
        { expiresAt: { gt: expect.any(Date) } },
      ]);
      expect(where.role).toEqual({ isActive: true });
    });
  });

  describe('podeAssumir', () => {
    it('é falso para empresa que não está na lista autorizada', async () => {
      jest.spyOn(service, 'empresasDoUsuario').mockResolvedValue([GDR]);

      expect(await service.podeAssumir('u1', GDR, CRD)).toBe(false);
      expect(await service.podeAssumir('u1', GDR, GDR)).toBe(true);
    });
  });
});
