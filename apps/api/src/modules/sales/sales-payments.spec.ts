import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentMethod, SalesOrderStatus } from '@prisma/client';
import { SalesService } from './sales.service';
import { PermissionService } from '../iam/permission.service';
import { companyScope } from '../iam/scope';
import { DiscountPolicyService } from './discount-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { AcquirerService } from '../acquirer/acquirer.service';
import { PaymentAuthorizationService } from '../payment-gateway/payment-authorization.service';

const tx = {
  salesPayment: { deleteMany: jest.fn() },
  salesOrder: { update: jest.fn() },
};

const mockPrisma = {
  salesOrder: { create: jest.fn(), findFirst: jest.fn() },
  customer: { findFirst: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn((fn: any) => fn(tx)),
};

const mockAcquirer = { resolveFee: jest.fn() };

const baseDto = {
  warehouseId: 'wh-1',
  items: [{ productId: 'p-1', quantity: 2, unitPrice: 5000 }], // total 10.000
} as any;

describe('SalesService — plano de pagamento (#584)', () => {
  let service: SalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: StockService, useValue: {} },
        { provide: TaxCalculationService, useValue: {} },
        { provide: DiscountPolicyService, useValue: { assertWithinLimit: jest.fn() } },
        { provide: AcquirerService, useValue: mockAcquirer },
        { provide: PaymentAuthorizationService, useValue: { authorizeCardPayments: jest.fn(), voidCardPayments: jest.fn() } },
        { provide: PermissionService, useValue: { getUserScope: jest.fn().mockResolvedValue(companyScope('user-1')) } },
      ],
    }).compile();
    service = module.get(SalesService);
    jest.clearAllMocks();
    mockPrisma.salesOrder.create.mockResolvedValue({ id: 'so-1' });
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(tx));
  });

  describe('createOrder', () => {
    it('sem payments → comportamento legado intacto', async () => {
      await service.createOrder(
        { ...baseDto, paymentMethod: PaymentMethod.PIX },
        'co-1',
        'user-1',
      );
      const data = mockPrisma.salesOrder.create.mock.calls[0][0].data;
      expect(data.paymentMethod).toBe(PaymentMethod.PIX);
      expect(data.payments).toBeUndefined();
    });

    it('rejeita plano que não fecha o total (itens + frete)', async () => {
      await expect(
        service.createOrder(
          {
            ...baseDto,
            payments: [{ method: PaymentMethod.PIX, amount: 9000 }],
          },
          'co-1',
        ),
      ).rejects.toThrow(/não fecha/);
    });

    it('frete compõe o total esperado do plano', async () => {
      await service.createOrder(
        {
          ...baseDto,
          freightValue: 500,
          payments: [{ method: PaymentMethod.PIX, amount: 10500 }],
        },
        'co-1',
      );
      expect(mockPrisma.salesOrder.create).toHaveBeenCalled();
    });

    it('cartão sem acquirerId → erro orientado', async () => {
      await expect(
        service.createOrder(
          {
            ...baseDto,
            payments: [
              { method: PaymentMethod.CARTAO_CREDITO, amount: 10000, installments: 6 },
            ],
          },
          'co-1',
        ),
      ).rejects.toThrow(/adquirente/);
    });

    it('cartão sem taxa vigente → erro orientado a cadastrar MDR', async () => {
      mockAcquirer.resolveFee.mockResolvedValue(null);
      await expect(
        service.createOrder(
          {
            ...baseDto,
            payments: [
              {
                method: PaymentMethod.CARTAO_CREDITO,
                amount: 10000,
                installments: 6,
                acquirerId: 'acq-1',
              },
            ],
          },
          'co-1',
        ),
      ).rejects.toThrow(/taxa vigente/);
    });

    it('cartão congela MDR/prazo e deriva paymentMethod legado da maior forma', async () => {
      mockAcquirer.resolveFee.mockResolvedValue({ feeId: 'fee-1', mdrRate: 3.5, settlementDays: 30 });

      await service.createOrder(
        {
          ...baseDto,
          payments: [
            { method: PaymentMethod.PIX, amount: 2000 },
            {
              method: PaymentMethod.CARTAO_CREDITO,
              amount: 8000,
              installments: 4,
              acquirerId: 'acq-1',
              brand: 'visa',
            },
          ],
        },
        'co-1',
      );

      const data = mockPrisma.salesOrder.create.mock.calls[0][0].data;
      expect(data.paymentMethod).toBe(PaymentMethod.CARTAO_CREDITO); // maior valor
      const card = data.payments.create.find((p: any) => p.method === PaymentMethod.CARTAO_CREDITO);
      expect(card).toEqual(
        expect.objectContaining({
          brand: 'VISA',
          mdrRate: 3.5,
          mdrAmount: 280, // 3,5% de 8.000
          settlementDays: 30,
          installments: 4,
        }),
      );
      // PIX não carrega adquirente/taxa
      const pix = data.payments.create.find((p: any) => p.method === PaymentMethod.PIX);
      expect(pix.mdrRate).toBeUndefined();
    });
  });

  describe('setPayments', () => {
    it('venda INVOICED → bloqueia alteração do plano', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.INVOICED,
        items: [{ quantity: 1, unitPrice: 100 }],
        freightValue: null,
      });
      await expect(
        service.setPayments('so-1', 'co-1', [{ method: PaymentMethod.PIX, amount: 100 }] as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('substitui o plano em transação (deleteMany + create)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        id: 'so-1',
        status: SalesOrderStatus.DRAFT,
        items: [{ quantity: 1, unitPrice: 1000 }],
        freightValue: null,
      });
      tx.salesOrder.update.mockResolvedValue({ id: 'so-1', payments: [] });

      await service.setPayments('so-1', 'co-1', [
        { method: PaymentMethod.PIX, amount: 1000 },
      ] as any);

      expect(tx.salesPayment.deleteMany).toHaveBeenCalledWith({ where: { salesOrderId: 'so-1' } });
      expect(tx.salesOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ paymentMethod: PaymentMethod.PIX }),
        }),
      );
    });
  });
});
