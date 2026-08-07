import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MovementType } from '@prisma/client';
import { StockService, classifyReplenishment, statusHavingClause } from './stock.service';
import { ReplenishmentStatus } from './dto/replenishment-query.dto';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  stockBalance: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
  $queryRawUnsafe: jest.fn(),
  $queryRaw: jest.fn(),
};

describe('StockService', () => {
  let service: StockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<StockService>(StockService);

    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  describe('move', () => {
    it('should throw BadRequestException when EXIT quantity exceeds available balance', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        available: 5,
        reserved: 0,
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ available: 5 }]);

      const dto = {
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.EXIT,
        quantity: 10,
        reason: 'Saída teste',
      };

      await expect(service.move(dto, 'user-1')).rejects.toThrow(BadRequestException);
      await expect(service.move(dto, 'user-1')).rejects.toThrow(
        'Saldo insuficiente. Disponível: 5, solicitado: 10',
      );
    });

    it('should create ENTRY movement and update balance with positive increment', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        available: 10,
        reserved: 0,
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ available: 10 }]);

      const createdMovement = {
        id: 'mov-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.ENTRY,
        quantity: 20,
        reason: 'Entrada de teste',
      };

      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue(createdMovement);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = {
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.ENTRY,
        quantity: 20,
        reason: 'Entrada de teste',
      };

      const result = await service.move(dto, 'user-1');

      expect(result).toEqual(createdMovement);
      expect(mockPrisma.stockBalance.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { available: { increment: 20 } },
        }),
      );
    });

    it('should call prisma.$transaction when moving stock', async () => {
      mockPrisma.stockBalance.findUnique.mockResolvedValue({
        id: 'bal-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        available: 50,
        reserved: 0,
      });
      mockPrisma.$queryRawUnsafe.mockResolvedValue([{ available: 50 }]);
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({ id: 'mov-1' });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const dto = {
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.EXIT,
        quantity: 10,
        reason: 'Saída de teste',
      };

      await service.move(dto, 'user-1');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('reverse', () => {
    it('should throw BadRequestException when trying to reverse a REVERSAL movement', async () => {
      mockPrisma.stockMovement.findFirst.mockResolvedValue({
        id: 'mov-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.REVERSAL,
        quantity: 10,
        reversedById: null,
      });

      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow('Não é possível estornar um estorno');
    });

    it('should throw ConflictException when movement already has reversedById set', async () => {
      mockPrisma.stockMovement.findFirst.mockResolvedValue({
        id: 'mov-1',
        companyId: 'co-1',
        warehouseId: 'wh-1',
        productId: 'p-1',
        type: MovementType.ENTRY,
        quantity: 10,
        reversedById: 'mov-estorno-1',
      });

      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.reverse('mov-1', 'Estorno teste', 'user-1', 'co-1'),
      ).rejects.toThrow('Este movimento já foi estornado');
    });
  });

  // #1031 — classificação de status é a peça que a issue pede coberta por
  // spec dos limites: igual ao mínimo, zero/sem mínimo definido, produto sem
  // saldo em nenhum depósito.
  describe('classifyReplenishment (limites)', () => {
    it('minStock <= 0 é sempre OK, independente do saldo ("zero"/"sem mínimo definido")', () => {
      expect(classifyReplenishment(0, 0)).toBe(ReplenishmentStatus.OK);
      expect(classifyReplenishment(0, 100)).toBe(ReplenishmentStatus.OK);
    });

    it('saldo igual ao mínimo é AT_RISK — não é déficit, mas a folga é zero', () => {
      expect(classifyReplenishment(10, 10)).toBe(ReplenishmentStatus.AT_RISK);
    });

    it('produto sem saldo em nenhum depósito (available=0) com mínimo > 0 é BELOW_MIN', () => {
      expect(classifyReplenishment(10, 0)).toBe(ReplenishmentStatus.BELOW_MIN);
    });

    it('saldo abaixo do mínimo é BELOW_MIN', () => {
      expect(classifyReplenishment(10, 9.99)).toBe(ReplenishmentStatus.BELOW_MIN);
    });

    it('margem de risco: [minStock, minStock*1.2) é AT_RISK; >= minStock*1.2 é OK', () => {
      expect(classifyReplenishment(10, 11.99)).toBe(ReplenishmentStatus.AT_RISK);
      expect(classifyReplenishment(10, 12)).toBe(ReplenishmentStatus.OK);
      expect(classifyReplenishment(10, 15)).toBe(ReplenishmentStatus.OK);
    });
  });

  // O stub de teste de `@prisma/client` (apps/api/src/__mocks__/generated/
  // prisma) não flatten `Prisma.sql`/`Prisma.empty` como o client real (só
  // `analytics.service.spec.ts` já convive com essa limitação — nenhum spec
  // do repo inspeciona `.text`/`.values`). Aqui a checagem é por
  // `JSON.stringify`, que atravessa a árvore de fragmentos aninhados e
  // encontra os literais/valores mesmo sem o flatten real.
  describe('statusHavingClause', () => {
    it('sem status: combina BELOW_MIN OU AT_RISK (o que precisa de atenção) — OK fica de fora', () => {
      const clause = JSON.stringify(statusHavingClause(undefined));
      expect(clause).toContain('OR');
      expect(clause).toContain('minStock');
    });

    it('cada status explícito monta uma cláusula diferente', () => {
      const below = JSON.stringify(statusHavingClause(ReplenishmentStatus.BELOW_MIN));
      const risk = JSON.stringify(statusHavingClause(ReplenishmentStatus.AT_RISK));
      const ok = JSON.stringify(statusHavingClause(ReplenishmentStatus.OK));
      expect(below).not.toEqual(risk);
      expect(risk).not.toEqual(ok);
      expect(below).not.toEqual(ok);
    });
  });

  describe('getReplenishment', () => {
    beforeEach(() => {
      mockPrisma.$queryRaw.mockReset();
    });

    it('retorna o envelope canônico {items,total,page,pageSize} e classifica cada linha', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ count: 2n }])
        .mockResolvedValueOnce([
          { productId: 'p-1', sku: 'SKU1', name: 'Produto crítico', type: 'FINISHED_GOOD', minStock: 10, available: 0 },
          { productId: 'p-2', sku: 'SKU2', name: 'Produto em risco', type: 'FINISHED_GOOD', minStock: 10, available: 10 },
        ]);

      const result = await service.getReplenishment('co-1', {});

      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25); // default do contrato #1028
      expect(result.items).toEqual([
        expect.objectContaining({ productId: 'p-1', gap: -10, status: ReplenishmentStatus.BELOW_MIN }),
        expect.objectContaining({ productId: 'p-2', gap: 0, status: ReplenishmentStatus.AT_RISK }),
      ]);
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('escopa por companyId em toda chamada (multi-tenant)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);

      await service.getReplenishment('co-42', {});

      const [countCall, listCall] = mockPrisma.$queryRaw.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(countCall).toContain('co-42');
      expect(listCall).toContain('co-42');
    });

    it('filtro de warehouseId restringe o saldo somado ao depósito informado (via JOIN, não WHERE)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);

      await service.getReplenishment('co-1', { warehouseId: 'wh-1' } as any);

      const [, listCall] = mockPrisma.$queryRaw.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(listCall).toContain('warehouseId');
      expect(listCall).toContain('wh-1');
    });

    it('sem warehouseId, não filtra por depósito (soma todos)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);

      await service.getReplenishment('co-1', {});

      const [, listCall] = mockPrisma.$queryRaw.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(listCall).not.toContain('wh-1');
    });

    it('filtro de categoria (type) faz cast explícito para o enum ProductType', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);

      await service.getReplenishment('co-1', { type: 'RAW_MATERIAL' } as any);

      const [, listCall] = mockPrisma.$queryRaw.mock.calls.map((c) => JSON.stringify(c[0]));
      expect(listCall).toContain('ProductType');
      expect(listCall).toContain('RAW_MATERIAL');
    });

    it('page/pageSize chegam como LIMIT/OFFSET na query de listagem', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 30n }]).mockResolvedValueOnce([]);

      const result = await service.getReplenishment('co-1', { page: 2, pageSize: 10 } as any);

      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
      const [, listCall] = mockPrisma.$queryRaw.mock.calls.map((c) => c[0]);
      // take=10, skip=(2-1)*10=10 — últimos dois valores interpolados no
      // template externo (LIMIT ${take} OFFSET ${skip}), depois do fragmento
      // `aggregated` aninhado.
      expect(listCall.values.slice(-2)).toEqual([10, 10]);
    });

    it('pageSize acima do teto é clampado em 100 (contrato #1028)', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ count: 0n }]).mockResolvedValueOnce([]);

      const result = await service.getReplenishment('co-1', { pageSize: 999 } as any);

      expect(result.pageSize).toBe(100);
    });
  });
});
