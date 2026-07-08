import { NotFoundException } from '@nestjs/common';
import { CompanyService } from './company.service';

/**
 * FIX anti-IDOR do escopo de empresa — #341 parte 2 (PR B, issue #620).
 *
 * Antes deste fix, findAll listava TODAS as empresas do banco para qualquer
 * autenticado e findOne/update aceitavam qualquer id (cross-tenant). Agora:
 *  - escopo global (SUPER_ADMIN → ADMIN_GLOBAL) vê/edita todas;
 *  - usuário comum só vê/edita a PRÓPRIA empresa do JWT;
 *  - fora do escopo → 404 (anti-enumeração), sem tocar o banco.
 */
describe('CompanyService — escopo de empresa (anti-IDOR #620)', () => {
  const MINHA = 'company-1';
  const OUTRA = 'company-2';

  let prisma: {
    company: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: CompanyService;

  const admin = { companyId: MINHA, role: 'SUPER_ADMIN' };
  const comum = { companyId: MINHA, role: 'FINANCIAL' };

  beforeEach(() => {
    prisma = {
      company: {
        create: jest.fn().mockResolvedValue({ id: 'nova' }),
        findMany: jest.fn().mockResolvedValue([{ id: MINHA }]),
        findUnique: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(
            [MINHA, OUTRA].includes(where.id) ? { id: where.id } : null,
          ),
        ),
        update: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve({ id: where.id, razaoSocial: 'Editada' }),
        ),
      },
    };
    service = new CompanyService(prisma as any);
  });

  describe('findAll', () => {
    it('escopo global (SUPER_ADMIN) lista todas as empresas', async () => {
      await service.findAll(admin);
      expect(prisma.company.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
    });

    it('usuário comum lista APENAS a própria empresa do JWT', async () => {
      await service.findAll(comum);
      expect(prisma.company.findMany).toHaveBeenCalledWith({
        where: { id: MINHA },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('usuário comum vê a própria empresa', async () => {
      await expect(service.findOne(MINHA, comum)).resolves.toEqual({ id: MINHA });
    });

    it('anti-IDOR: empresa de outro tenant → 404 SEM consultar o banco', async () => {
      await expect(service.findOne(OUTRA, comum)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('escopo global acessa qualquer empresa', async () => {
      await expect(service.findOne(OUTRA, admin)).resolves.toEqual({ id: OUTRA });
    });

    it('empresa inexistente → mesma NotFoundException (anti-enumeração)', async () => {
      await expect(service.findOne('nao-existe', admin)).rejects.toThrow(
        NotFoundException,
      );
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
        service.update(OUTRA, { razaoSocial: 'Hack' } as any, comum),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('escopo global edita qualquer empresa', async () => {
      await service.update(OUTRA, { razaoSocial: 'OK' } as any, admin);
      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: OUTRA },
        data: { razaoSocial: 'OK' },
      });
    });
  });
});
