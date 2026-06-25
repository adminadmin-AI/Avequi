import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { BudgetService } from './budget.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BudgetService', () => {
  let service: BudgetService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      budget: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
      financialEntry: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BudgetService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<BudgetService>(BudgetService);
  });

  it('should upsert a budget line', async () => {
    prisma.budget.upsert.mockResolvedValue({ id: 'b1', amount: 10000 });
    const result = await service.upsert('comp-1', { year: 2026, month: 6, amount: 10000 });
    expect(result.amount).toBe(10000);
  });

  it('should reject invalid month', async () => {
    await expect(service.upsert('comp-1', { year: 2026, month: 13, amount: 100 })).rejects.toThrow(BadRequestException);
  });

  it('should calculate variance with alert at 90%', async () => {
    prisma.budget.findMany.mockResolvedValue([
      { month: 6, amount: '10000' },
    ]);
    prisma.financialEntry.findMany.mockResolvedValue([
      { amount: '9500', type: 'EXPENSE', categoryId: null, createdAt: new Date('2026-06-15') },
    ]);

    const result = await service.getVariance('comp-1', 2026);
    const june = result.months.find((m: any) => m.month === 6);
    expect(june.alert).toBe(true);
    expect(june.variance).toBe(-5); // (9500-10000)/10000 * 100
  });
});
