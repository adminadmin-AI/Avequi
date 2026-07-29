import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BomService } from './bom.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  product: {
    findMany: jest.fn(),
  },
  bomVersion: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
  // #815 — validação de routingStepId por item
  routingStep: {
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('BomService', () => {
  let service: BomService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BomService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<BomService>(BomService);
  });

  describe('create', () => {
    const mockUser = { id: 'user-1', companyId: 'company-1' };

    it('should throw NotFoundException when a componentId does not exist in DB', async () => {
      const dto = {
        productId: 'prod-1',
        items: [
          { componentId: 'comp-missing', quantity: 1 },
        ],
      };

      // Return empty array — component not found
      mockPrisma.product.findMany.mockResolvedValueOnce([]);

      await expect(service.create(dto, mockUser)).rejects.toThrow(NotFoundException);
    });

    it('should auto-increment version (first BOM = v1)', async () => {
      const dto = {
        productId: 'prod-1',
        items: [{ componentId: 'comp-1', quantity: 2 }],
      };

      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce(null); // no existing version
      mockPrisma.bomVersion.create.mockResolvedValueOnce({
        id: 'bom-v1',
        version: 1,
        isActive: false,
        productId: 'prod-1',
        companyId: 'company-1',
        items: [],
      });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.create(dto, mockUser);
      expect(mockPrisma.bomVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1, companyId: 'company-1' }),
        }),
      );
      expect(result.version).toBe(1);
    });

    it('should auto-increment version to v2 when v1 already exists', async () => {
      const dto = {
        productId: 'prod-1',
        items: [{ componentId: 'comp-1', quantity: 2 }],
      };

      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce({ version: 1 }); // existing v1
      mockPrisma.bomVersion.create.mockResolvedValueOnce({
        id: 'bom-v2',
        version: 2,
        isActive: false,
        productId: 'prod-1',
        companyId: 'company-1',
        items: [],
      });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.create(dto, mockUser);
      expect(mockPrisma.bomVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 2 }),
        }),
      );
      expect(result.version).toBe(2);
    });

    it('IDOR: ignora companyId externo injetado no payload e usa o do JWT', async () => {
      const dto = {
        productId: 'prod-1',
        companyId: 'company-VITIMA',
        items: [{ componentId: 'comp-1', quantity: 2 }],
      } as any;

      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce(null);
      mockPrisma.bomVersion.create.mockResolvedValueOnce({ id: 'bom-v1', version: 1, items: [] });
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.create(dto, mockUser);

      // Componentes validados contra a empresa do JWT
      expect(mockPrisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }),
        }),
      );
      // BOM criada na empresa do JWT, não na injetada
      const createArg = mockPrisma.bomVersion.create.mock.calls[0][0];
      expect(createArg.data.companyId).toBe('company-1');
    });
  });

  // ─── #815: componente alocado à operação do roteiro ─────────────────────────

  describe('create — routingStepId (#815)', () => {
    const mockUser = { id: 'user-1', companyId: 'company-1' };

    const dtoComStep = {
      productId: 'prod-1',
      items: [{ componentId: 'comp-1', quantity: 2, routingStepId: 'step-1' }],
    };

    beforeEach(() => {
      mockPrisma.product.findMany.mockResolvedValue([{ id: 'comp-1' }]);
      mockPrisma.bomVersion.findFirst.mockResolvedValue(null);
      mockPrisma.bomVersion.create.mockResolvedValue({ id: 'bom-v1', version: 1, items: [] });
      mockPrisma.auditLog.create.mockResolvedValue({});
    });

    it('aceita routingStepId do mesmo produto e da mesma empresa', async () => {
      mockPrisma.routingStep.findMany.mockResolvedValueOnce([
        { id: 'step-1', productId: 'prod-1', name: 'Solda' },
      ]);

      await service.create(dtoComStep as any, mockUser);

      // Busca escopada pela empresa do JWT
      expect(mockPrisma.routingStep.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ companyId: 'company-1' }),
        }),
      );
      const itens = mockPrisma.bomVersion.create.mock.calls[0][0].data.items.create;
      expect(itens[0].routingStepId).toBe('step-1');
    });

    it('rejeita passo de OUTRO PRODUTO', async () => {
      mockPrisma.routingStep.findMany.mockResolvedValueOnce([
        { id: 'step-1', productId: 'prod-OUTRO', name: 'Solda' },
      ]);

      await expect(service.create(dtoComStep as any, mockUser)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockPrisma.bomVersion.create).not.toHaveBeenCalled();
    });

    it('rejeita passo de OUTRA EMPRESA', async () => {
      // Busca é escopada por companyId, então o passo simplesmente não retorna
      mockPrisma.routingStep.findMany.mockResolvedValueOnce([]);

      await expect(service.create(dtoComStep as any, mockUser)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockPrisma.bomVersion.create).not.toHaveBeenCalled();
    });

    it('item SEM routingStepId continua válido — grava null', async () => {
      const dtoSemStep = {
        productId: 'prod-1',
        items: [{ componentId: 'comp-1', quantity: 2 }],
      };

      await service.create(dtoSemStep as any, mockUser);

      // Sem nenhum step no payload, nem consulta o roteiro
      expect(mockPrisma.routingStep.findMany).not.toHaveBeenCalled();
      const itens = mockPrisma.bomVersion.create.mock.calls[0][0].data.items.create;
      expect(itens[0].routingStepId).toBeNull();
    });

    it('valida cada passo distinto uma única vez, mesmo repetido em vários itens', async () => {
      // Dois componentes diferentes apontando para a MESMA operação
      mockPrisma.product.findMany.mockResolvedValueOnce([{ id: 'comp-1' }, { id: 'comp-2' }]);
      mockPrisma.routingStep.findMany.mockResolvedValueOnce([
        { id: 'step-1', productId: 'prod-1', name: 'Solda' },
      ]);

      await service.create(
        {
          productId: 'prod-1',
          items: [
            { componentId: 'comp-1', quantity: 1, routingStepId: 'step-1' },
            { componentId: 'comp-2', quantity: 3, routingStepId: 'step-1' },
          ],
        } as any,
        mockUser,
      );

      // step-1 aparece uma vez só na consulta
      const where = mockPrisma.routingStep.findMany.mock.calls[0][0].where;
      expect(where.id.in).toEqual(['step-1']);
    });
  });

  describe('activate', () => {
    it('should set old active version to isActive=false, new one to isActive=true', async () => {
      const bomVersionId = 'bom-v2';
      const companyId = 'company-1';

      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce({
        id: bomVersionId,
        productId: 'prod-1',
        companyId,
        version: 2,
        isActive: false,
      });

      const txResult = {
        id: bomVersionId,
        version: 2,
        isActive: true,
        productId: 'prod-1',
        companyId,
        items: [],
      };

      mockPrisma.$transaction.mockImplementationOnce(async (fn) => {
        const txMock = {
          bomVersion: {
            updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }),
            update: jest.fn().mockResolvedValueOnce(txResult),
          },
        };
        return fn(txMock);
      });

      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.activate(bomVersionId, companyId);
      expect(result.isActive).toBe(true);
    });

    it('should throw NotFoundException when BOM version not found', async () => {
      mockPrisma.bomVersion.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.activate('non-existent-id', 'company-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
