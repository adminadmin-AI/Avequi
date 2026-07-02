import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TributaryClassificationService } from './tributary-classification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CCLASSTRIB_TABLE } from './data/cclasstrib.data';

describe('TributaryClassificationService', () => {
  let service: TributaryClassificationService;
  let prisma: {
    tributaryClassification: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      tributaryClassification: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        TributaryClassificationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(TributaryClassificationService);
  });

  describe('tabela oficial embarcada', () => {
    it('contém os 164 códigos da IT 2025.002 (publicação 22/06/2026)', () => {
      expect(CCLASSTRIB_TABLE).toHaveLength(164);
      expect(new Set(CCLASSTRIB_TABLE.map((c) => c.code)).size).toBe(164);
    });

    it('inclui o código 000001 (tributação integral, CST 000) usado pela GDR', () => {
      const c = CCLASSTRIB_TABLE.find((e) => e.code === '000001');
      expect(c).toBeDefined();
      expect(c!.cst).toBe('000');
      expect(c!.allowsNfe).toBe(true);
    });

    it('todos os códigos têm 6 dígitos e CST de 3 dígitos', () => {
      for (const c of CCLASSTRIB_TABLE) {
        expect(c.code).toMatch(/^\d{6}$/);
        expect(c.cst).toMatch(/^\d{3}$/);
      }
    });
  });

  describe('syncFromOfficialTable', () => {
    it('cria códigos novos e atualiza existentes (upsert por code)', async () => {
      // primeiro código já existe, demais não
      prisma.tributaryClassification.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.code === CCLASSTRIB_TABLE[0].code ? { id: 'x', code: where.code } : null),
      );
      prisma.tributaryClassification.create.mockResolvedValue({});
      prisma.tributaryClassification.update.mockResolvedValue({});

      const result = await service.syncFromOfficialTable();

      expect(result.total).toBe(164);
      expect(result.updated).toBe(1);
      expect(result.created).toBe(163);
    });

    it('deriva isExempt para CST 400/410 e isReduced para redução percentual', async () => {
      prisma.tributaryClassification.findUnique.mockResolvedValue(null);
      prisma.tributaryClassification.create.mockResolvedValue({});

      await service.syncFromOfficialTable();

      const created = prisma.tributaryClassification.create.mock.calls.map((c) => c[0].data);
      const exempt = created.filter((d) => d.isExempt);
      expect(exempt.length).toBeGreaterThan(0);
      expect(exempt.every((d) => ['400', '410'].includes(d.cst))).toBe(true);

      const reduced = created.filter((d) => d.percRedIbs > 0 || d.percRedCbs > 0);
      expect(reduced.every((d) => d.isReduced)).toBe(true);
    });
  });

  describe('validateForNfe', () => {
    it('aceita código vigente e aplicável a NF-e', async () => {
      prisma.tributaryClassification.findUnique.mockResolvedValue({
        code: '000001', allowsNfe: true, validFrom: new Date('2025-05-05'), validTo: null,
      });
      expect(await service.validateForNfe('000001')).toBe(true);
    });

    it('rejeita código inexistente, não-NF-e ou fora de vigência', async () => {
      prisma.tributaryClassification.findUnique.mockResolvedValue(null);
      expect(await service.validateForNfe('999999')).toBe(false);

      prisma.tributaryClassification.findUnique.mockResolvedValue({
        code: '000002', allowsNfe: false, validFrom: null, validTo: null,
      });
      expect(await service.validateForNfe('000002')).toBe(false);

      prisma.tributaryClassification.findUnique.mockResolvedValue({
        code: '000003', allowsNfe: true, validFrom: null, validTo: new Date('2025-01-01'),
      });
      expect(await service.validateForNfe('000003')).toBe(false);
    });
  });

  describe('findByCode', () => {
    it('lança NotFoundException para código inexistente', async () => {
      prisma.tributaryClassification.findUnique.mockResolvedValue(null);
      await expect(service.findByCode('999999')).rejects.toThrow(NotFoundException);
    });
  });
});
