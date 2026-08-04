import { NotFoundException } from '@nestjs/common';
import { CompanyService } from './company.service';

/**
 * FIX anti-IDOR do escopo de empresa — #341 parte 2 (PR B, issue #620),
 * reescrito no #947 quando o eixo do escopo deixou de ser o enum.
 *
 * Antes do #620, findAll listava TODAS as empresas do banco para qualquer
 * autenticado e findOne/update aceitavam qualquer id (cross-tenant). Depois do
 * #620 o escopo passou a existir, mas quem o ampliava era o enum SUPER_ADMIN —
 * e "ampliar" queria dizer o BANCO INTEIRO, incluindo outros tenants.
 *
 * Agora (#947):
 *  - a ampliação é a capability `iam.tenant-scope.cross-company`;
 *  - o alvo dela é o GRUPO da empresa (raiz + filiais), nunca o banco;
 *  - usuário comum só vê/edita a PRÓPRIA empresa do JWT;
 *  - fora do escopo → 404 (anti-enumeração), sem tocar o banco.
 */
describe('CompanyService — escopo de empresa (anti-IDOR #620 + capability #947)', () => {
  const MINHA = 'company-1';
  const FILIAL = 'company-1-filial';
  const OUTRO_TENANT = 'company-2';

  let prisma: any;
  let tenantScope: { resolverEscopo: jest.Mock };
  let service: CompanyService;

  /** Quem tem a capability: enxerga o grupo (própria + filial). */
  const admin = { id: 'u-admin', companyId: MINHA };
  /** Quem não tem: só a própria empresa. */
  const comum = { id: 'u-comum', companyId: MINHA };

  beforeEach(() => {
    prisma = {
      company: {
        create: jest.fn().mockResolvedValue({ id: 'nova' }),
        findMany: jest.fn().mockResolvedValue([{ id: MINHA }]),
        findUnique: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(
            [MINHA, FILIAL, OUTRO_TENANT].includes(where.id) ? { id: where.id } : null,
          ),
        ),
        update: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: where.id, razaoSocial: 'Editada' }),
        ),
      },
    };
    tenantScope = {
      resolverEscopo: jest.fn().mockImplementation((userId: string, companyId: string) =>
        Promise.resolve(
          userId === admin.id
            ? { companyIds: [MINHA, FILIAL], ampliado: true }
            : { companyIds: [companyId], ampliado: false },
        ),
      ),
    };
    service = new CompanyService(prisma as any, tenantScope as any);
  });

  describe('findAll', () => {
    it('com a capability lista o GRUPO — e o filtro continua existindo', async () => {
      await service.findAll(admin);
      expect(prisma.company.findMany).toHaveBeenCalledWith({
        where: { id: { in: [MINHA, FILIAL] } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('#947: ampliar NÃO significa "todas as empresas do banco"', async () => {
      await service.findAll(admin);
      const arg = prisma.company.findMany.mock.calls[0][0];
      // a regressão que este teste existe para pegar: um `findMany` sem where
      expect(arg.where).toBeDefined();
      expect(arg.where.id.in).not.toContain(OUTRO_TENANT);
    });

    it('usuário comum lista APENAS a própria empresa do JWT', async () => {
      await service.findAll(comum);
      expect(prisma.company.findMany).toHaveBeenCalledWith({
        where: { id: { in: [MINHA] } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('chamada interna (sem usuário) não aplica recorte', async () => {
      await service.findAll();
      expect(prisma.company.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
      expect(tenantScope.resolverEscopo).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('usuário comum vê a própria empresa', async () => {
      await expect(service.findOne(MINHA, comum)).resolves.toEqual({ id: MINHA });
    });

    it('anti-IDOR: empresa de outro tenant → 404 SEM consultar o banco', async () => {
      await expect(service.findOne(OUTRO_TENANT, comum)).rejects.toThrow(NotFoundException);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('com a capability acessa a filial do próprio grupo', async () => {
      await expect(service.findOne(FILIAL, admin)).resolves.toEqual({ id: FILIAL });
    });

    it('#947: nem com a capability acessa empresa de OUTRO grupo → 404', async () => {
      await expect(service.findOne(OUTRO_TENANT, admin)).rejects.toThrow(NotFoundException);
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('empresa inexistente → mesma NotFoundException (anti-enumeração)', async () => {
      await expect(service.findOne('nao-existe', admin)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('usuário comum edita a própria empresa', async () => {
      await service.update(MINHA, { razaoSocial: 'Editada' } as any, comum);
      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: MINHA },
        data: { razaoSocial: 'Editada' },
      });
    });

    it('anti-IDOR: editar empresa de outro tenant → 404 SEM escrever no banco', async () => {
      await expect(
        service.update(OUTRO_TENANT, { razaoSocial: 'Hack' } as any, comum),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('com a capability edita a filial do próprio grupo', async () => {
      await service.update(FILIAL, { razaoSocial: 'OK' } as any, admin);
      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: FILIAL },
        data: { razaoSocial: 'OK' },
      });
    });

    it('#947: nem com a capability escreve em empresa de outro grupo', async () => {
      await expect(
        service.update(OUTRO_TENANT, { razaoSocial: 'Hack' } as any, admin),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });
  });
});
