import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SalesOrderStatus } from '@prisma/client';
import { BILLING_BLOCK_OVERRIDE_PERMISSION, SalesService } from './sales.service';
import { DiscountPolicyService } from './discount-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { AcquirerService } from '../acquirer/acquirer.service';
import { PaymentAuthorizationService } from '../payment-gateway/payment-authorization.service';
import { PermissionService } from '../iam/permission.service';
import { companyScope, SYSTEM_CONTEXT, userContext } from '../iam/scope';
import { SALE_CONFIRMED_EVENT } from './events/sale-confirmed.event';
import { SALE_INVOICED_EVENT } from './events/sale-invoiced.event';

const mockPrisma = {
  salesOrder: {
    create: jest.fn(),
    update: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  stockBalance: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  stockMovement: {
    create: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  financialEntry: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    aggregate: jest.fn().mockResolvedValue({ _sum: { amount: null } }),
  },
  fiscalDocument: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  serialNumber: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  // #584: select da maquininha no plano de pagamento
  acquirer: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  // #595: validação de chassi na venda balcão
  product: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  // #475: crédito e bloqueio de faturamento
  customer: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

// #347-B: default = visão da empresa (comportamento de sempre)
const mockPermissions = {
  getUserScope: jest.fn(),
  // #947: override de faturamento bloqueado agora é permissão
  hasAnyPermission: jest.fn(),
};

const mockPaymentAuth = {
  authorizeCardPayments: jest.fn(),
  voidCardPayments: jest.fn().mockResolvedValue(undefined),
};
const mockEventEmitter = { emit: jest.fn() };

const mockStockService = {
  reserveBalance: jest.fn(),
  releaseBalance: jest.fn(),
  consumeReserved: jest.fn(),
  returnStock: jest.fn(),
  receiveGoods: jest.fn(),
};

// #498: pré-checagem de regra fiscal no faturamento — default: regra existe
const mockTaxCalc = { findBestRule: jest.fn().mockResolvedValue({ id: 'rule-1' }) };

const baseOrder = {
  id: 'so-1',
  companyId: 'co-1',
  warehouseId: 'wh-1',
  status: SalesOrderStatus.DRAFT,
  items: [
    { id: 'si-1', productId: 'p-1', quantity: 5, unitPrice: 100 },
  ],
};

describe('SalesService', () => {
  let service: SalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: StockService, useValue: mockStockService },
        { provide: TaxCalculationService, useValue: mockTaxCalc },
        { provide: DiscountPolicyService, useValue: { assertWithinLimit: jest.fn().mockResolvedValue(undefined) } },
        { provide: AcquirerService, useValue: { resolveFee: jest.fn().mockResolvedValue(null) } },
        { provide: PaymentAuthorizationService, useValue: mockPaymentAuth },
        { provide: PermissionService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();
    mockPrisma.financialEntry.findMany.mockResolvedValue([]); // #586 — devolução varre 1:N
    mockTaxCalc.findBestRule.mockResolvedValue({ id: 'rule-1' });
    mockPrisma.product.findMany.mockResolvedValue([]); // #595
    mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 1 }); // #595 happy path
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    mockPermissions.getUserScope.mockResolvedValue(companyScope('user-1')); // #347-B
    // #947: padrão = SEM o override; quem sobrepõe declara no próprio teste
    mockPermissions.hasAnyPermission.mockResolvedValue(false);
  });

  // ─── checkoutCounterSale (#595) — venda balcão ────────────────────────────

  describe('checkoutCounterSale', () => {
    const trailer = { id: 'p-1', name: 'Reboque', tracksSerial: true };
    const counterOrder = {
      id: 'so-b', companyId: 'co-1', warehouseId: 'wh-1',
      status: SalesOrderStatus.DRAFT, channel: 'COUNTER', customer: null,
      items: [{ id: 'si-1', productId: 'p-1', quantity: 1, unitPrice: 100, serialNumberId: 'sn-1', product: trailer }],
    };

    it('rejeita venda que não é do canal COUNTER', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({ ...counterOrder, channel: 'FACTORY' });
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(/COUNTER/);
    });

    it('rejeita quando não está em DRAFT', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({ ...counterOrder, status: SalesOrderStatus.INVOICED });
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(BadRequestException);
    });

    it('bloqueia cliente com faturamento bloqueado (sem a permissão de exceção)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...counterOrder, customer: { billingBlocked: true, billingBlockReason: 'inadimplente' },
      });
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(/bloqueado/);
    });

    it('#947: com a permissão sobrepõe o bloqueio e fecha a venda', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...counterOrder, customer: { billingBlocked: true },
      });
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 5, reserved: 0 });
      mockPrisma.salesOrder.update.mockResolvedValue({ ...counterOrder, status: SalesOrderStatus.READY_TO_INVOICE, payments: [] });
      const res = await service.checkoutCounterSale('so-b', 'co-1', userContext('u1'));
      expect(res.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
      expect(mockPermissions.hasAnyPermission).toHaveBeenCalledWith('u1', 'co-1', [
        BILLING_BLOCK_OVERRIDE_PERMISSION,
      ]);
    });

    it('rejeita estoque insuficiente', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(counterOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 0, reserved: 0 });
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(/insuficiente/);
    });

    // ── W16-40 (NT 2026.002): venda acima do limite exige cliente identificado ──
    it('W16-40: venda > R$ 10.000 SEM cliente identificado → 400 orientado', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...counterOrder,
        items: [{ ...counterOrder.items[0], quantity: 1, unitPrice: 15000 }],
      });
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(/W16-40/);
    });

    it('W16-40: cliente sem CPF/CNPJ no cadastro também bloqueia acima do limite', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...counterOrder,
        customer: { document: null },
        items: [{ ...counterOrder.items[0], quantity: 1, unitPrice: 15000 }],
      });
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(/identificação/);
    });

    it('W16-40: venda > limite COM cliente documentado fecha normal', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...counterOrder,
        customer: { document: '04252011043' },
        items: [{ ...counterOrder.items[0], quantity: 1, unitPrice: 15000 }],
      });
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 5, reserved: 0 });
      mockPrisma.salesOrder.update.mockResolvedValue({ ...counterOrder, status: SalesOrderStatus.READY_TO_INVOICE, payments: [] });
      const res = await service.checkoutCounterSale('so-b', 'co-1', userContext('u1'));
      expect(res.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
    });

    it('reserva estoque, amarra o chassi (IN_STOCK→RESERVED_FOR_SALE) e vai a READY_TO_INVOICE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(counterOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 3, reserved: 0 });
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.salesOrder.update.mockResolvedValue({ ...counterOrder, status: SalesOrderStatus.READY_TO_INVOICE, payments: [] });

      const res = await service.checkoutCounterSale('so-b', 'co-1', userContext('u1'));

      expect(res.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
      expect(mockStockService.reserveBalance).toHaveBeenCalledWith('wh-1', 'p-1', 1, 'co-1', mockPrisma);
      expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'sn-1', status: 'IN_STOCK', salesOrderId: null }),
          data: expect.objectContaining({ status: 'RESERVED_FOR_SALE', salesOrderId: 'so-b' }),
        }),
      );
    });

    it('falha na corrida se o chassi já foi reservado por outra venda (guard de concorrência)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(counterOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 3, reserved: 0 });
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 0 }); // ninguém flipou
      await expect(service.checkoutCounterSale('so-b', 'co-1', userContext('u1'))).rejects.toThrow(/não está mais disponível/);
    });
  });

  describe('listAcquirerOptions (#584)', () => {
    it('retorna SÓ id+nome de adquirentes ativas da company (taxas ficam fora)', async () => {
      mockPrisma.acquirer.findMany.mockResolvedValue([{ id: 'a1', name: 'Cielo' }]);
      const res = await service.listAcquirerOptions('co-1');
      expect(res).toEqual([{ id: 'a1', name: 'Cielo' }]);
      const arg = mockPrisma.acquirer.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ companyId: 'co-1', isActive: true });
      expect(arg.select).toEqual({ id: true, name: true }); // nunca fees/MDR
    });
  });

  describe('listCounterSerials (#595)', () => {
    it('exige productId e warehouseId', async () => {
      await expect(service.listCounterSerials('co-1', '', 'wh-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
      await expect(service.listCounterSerials('co-1', 'p-1', '', userContext('user-1'))).rejects.toThrow(BadRequestException);
    });

    it('lista só chassis IN_STOCK e livres do produto/depósito', async () => {
      mockPrisma.serialNumber.findMany.mockResolvedValue([{ id: 'sn-1', serial: 'VIN1' }]);
      const res = await service.listCounterSerials('co-1', 'p-1', 'wh-1', userContext('user-1'));
      expect(res).toHaveLength(1);
      expect(mockPrisma.serialNumber.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'co-1', productId: 'p-1', warehouseId: 'wh-1', status: 'IN_STOCK', salesOrderId: null },
        }),
      );
    });
  });

  // ─── createOrder — validação de chassi no canal COUNTER (#595) ────────────

  describe('createOrder (canal COUNTER)', () => {
    const dtoBase = {
      warehouseId: 'wh-1',
      items: [{ productId: 'p-1', quantity: 1, unitPrice: 100, serialNumberId: 'sn-1' }],
      channel: 'COUNTER' as const,
    };
    const trailer = { id: 'p-1', name: 'Reboque', tracksSerial: true };

    it('exige chassi escaneado em item rastreável', async () => {
      mockPrisma.product.findMany.mockResolvedValue([trailer]);
      const dto = { ...dtoBase, items: [{ productId: 'p-1', quantity: 1, unitPrice: 100 }] };
      await expect(service.createOrder(dto as any, 'co-1', userContext('u1'))).rejects.toThrow(/escaneie o chassi/i);
    });

    it('rejeita chassi que não está IN_STOCK', async () => {
      mockPrisma.product.findMany.mockResolvedValue([trailer]);
      mockPrisma.serialNumber.findFirst.mockResolvedValue({
        id: 'sn-1', serial: 'VIN1', productId: 'p-1', warehouseId: 'wh-1', status: 'SOLD', salesOrderId: null,
      });
      await expect(service.createOrder(dtoBase as any, 'co-1', userContext('u1'))).rejects.toThrow(/não está disponível/);
    });

    it('rejeita chassi de outro depósito', async () => {
      mockPrisma.product.findMany.mockResolvedValue([trailer]);
      mockPrisma.serialNumber.findFirst.mockResolvedValue({
        id: 'sn-1', serial: 'VIN1', productId: 'p-1', warehouseId: 'wh-OUTRO', status: 'IN_STOCK', salesOrderId: null,
      });
      await expect(service.createOrder(dtoBase as any, 'co-1', userContext('u1'))).rejects.toThrow(/depósito/);
    });

    it('cria a venda balcão gravando canal e chassi no item', async () => {
      mockPrisma.product.findMany.mockResolvedValue([trailer]);
      mockPrisma.serialNumber.findFirst.mockResolvedValue({
        id: 'sn-1', serial: 'VIN1', productId: 'p-1', warehouseId: 'wh-1', status: 'IN_STOCK', salesOrderId: null,
      });
      mockPrisma.salesOrder.create.mockResolvedValue({ id: 'so-b', channel: 'COUNTER', items: [] });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.createOrder(dtoBase as any, 'co-1', userContext('u1'));

      const createArg = mockPrisma.salesOrder.create.mock.calls[0][0];
      expect(createArg.data.channel).toBe('COUNTER');
      expect(createArg.data.items.create[0].serialNumberId).toBe('sn-1');
    });
  });

  // ─── reserveOrder (S07.03) ────────────────────────────────────────────────

  describe('reserveOrder', () => {
    it('deve lançar NotFoundException quando OV não existe', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.reserveOrder('so-x', 'co-1', userContext('user-1'))).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando OV não está em DRAFT', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      await expect(service.reserveOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando OV não tem itens', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({ ...baseOrder, items: [] });
      await expect(service.reserveOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando estoque disponível é insuficiente', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 3, reserved: 0 });

      await expect(service.reserveOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
      await expect(service.reserveOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(/insuficiente/);
    });

    it('deve lançar BadRequestException quando não há saldo cadastrado', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue(null);

      await expect(service.reserveOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
    });

    it('deve reservar estoque e mudar status para RESERVED quando há saldo suficiente', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      mockPrisma.stockBalance.findUnique.mockResolvedValue({ available: 10, reserved: 0 });
      const reservedOrder = { ...baseOrder, status: SalesOrderStatus.RESERVED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(reservedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.reserveOrder('so-1', 'co-1', userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.RESERVED);
      expect(mockStockService.reserveBalance).toHaveBeenCalledWith(
        'wh-1', 'p-1', 5, 'co-1', mockPrisma,
      );
    });
  });

  // ─── confirmOrder (S07.04a) — confirma e dispara picking ──────────────────

  describe('confirmOrder', () => {
    it('deve lançar NotFoundException quando OV não existe', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.confirmOrder('so-x', 'co-1', userContext('user-1'))).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando OV não está RESERVED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder); // DRAFT
      await expect(service.confirmOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
      await expect(service.confirmOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(/RESERVADAS/);
    });

    it('deve mudar status para AWAITING_PICKING e emitir SALE_CONFIRMED_EVENT', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      const confirmedOrder = {
        ...baseOrder,
        companyId: 'co-1',
        warehouseId: 'wh-1',
        status: SalesOrderStatus.AWAITING_PICKING,
        confirmedAt: new Date(),
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(confirmedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.confirmOrder('so-1', 'co-1', userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.AWAITING_PICKING);
      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
      expect(mockPrisma.stockMovement.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SALE_CONFIRMED_EVENT,
        expect.objectContaining({ salesOrderId: 'so-1', warehouseId: 'wh-1' }),
      );
    });
  });

  // ─── #475: bloqueio de faturamento e alerta de crédito ────────────────────

  describe('confirmOrder — crédito e bloqueio (#475)', () => {
    const blockedOrder = {
      ...baseOrder,
      status: SalesOrderStatus.RESERVED,
      customerId: 'cust-1',
      customer: { billingBlocked: true, billingBlockReason: 'Inadimplência', name: 'Cliente X' },
    };

    it('cliente bloqueado não confirma OV', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(blockedOrder);
      await expect(service.confirmOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(
        /faturamento bloqueado: Inadimplência/,
      );
      expect(mockPrisma.salesOrder.update).not.toHaveBeenCalled();
    });

    it('#947: quem tem a permissão pode sobrepor o bloqueio', async () => {
      mockPermissions.hasAnyPermission.mockResolvedValue(true);
      mockPrisma.salesOrder.findFirst.mockResolvedValue(blockedOrder);
      mockPrisma.customer.findFirst.mockResolvedValue({ creditLimit: null, name: 'Cliente X' });
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...blockedOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});
      const result = await service.confirmOrder('so-1', 'co-1', userContext('user-1'));
      expect(result.status).toBe(SalesOrderStatus.AWAITING_PICKING);
    });

    it('alerta de crédito quando em aberto + OV estoura o limite (não bloqueia)', async () => {
      const order = {
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
        customerId: 'cust-1',
        customer: { billingBlocked: false, name: 'Cliente X' },
      };
      mockPrisma.salesOrder.findFirst.mockResolvedValue(order);
      mockPrisma.customer.findFirst.mockResolvedValue({ creditLimit: 1000, name: 'Cliente X' });
      // em aberto 800 + OV 500 (5 × 100) > limite 1000
      mockPrisma.financialEntry.aggregate.mockResolvedValue({ _sum: { amount: 800 } });
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.AWAITING_PICKING,
        items: baseOrder.items,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result: any = await service.confirmOrder('so-1', 'co-1', userContext('user-1'));
      expect(result.status).toBe(SalesOrderStatus.AWAITING_PICKING);
      expect(result.creditAlert).toMatch(/Limite de crédito excedido/);
      expect(result.creditAlert).toContain('800.00');
      expect(result.creditAlert).toContain('500.00');
    });

    it('dentro do limite não gera alerta', async () => {
      const order = {
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
        customerId: 'cust-1',
        customer: { billingBlocked: false, name: 'Cliente X' },
      };
      mockPrisma.salesOrder.findFirst.mockResolvedValue(order);
      mockPrisma.customer.findFirst.mockResolvedValue({ creditLimit: 10000, name: 'Cliente X' });
      mockPrisma.financialEntry.aggregate.mockResolvedValue({ _sum: { amount: 800 } });
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...order,
        status: SalesOrderStatus.AWAITING_PICKING,
        items: baseOrder.items,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result: any = await service.confirmOrder('so-1', 'co-1', userContext('user-1'));
      expect(result.creditAlert).toBeUndefined();
    });
  });

  // ─── markReadyToInvoice (S07.04a2) ───────────────────────────────────────

  describe('markReadyToInvoice', () => {
    it('deve lançar NotFoundException quando OV não existe', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.markReadyToInvoice('so-x', SYSTEM_CONTEXT)).rejects.toThrow(NotFoundException);
    });

    it('deve lançar BadRequestException quando OV não está AWAITING_PICKING', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.CONFIRMED,
      });
      await expect(service.markReadyToInvoice('so-1', SYSTEM_CONTEXT)).rejects.toThrow(BadRequestException);
    });

    it('picking concluído leva a AWAITING_CONFERENCE com pickedAt (#491)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
      });
      const readyOrder = {
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_CONFERENCE,
        pickedAt: new Date(),
        items: [],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(readyOrder);

      const result = await service.markReadyToInvoice('so-1', SYSTEM_CONTEXT);

      expect(result.status).toBe(SalesOrderStatus.AWAITING_CONFERENCE);
      expect(mockPrisma.salesOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: SalesOrderStatus.AWAITING_CONFERENCE,
          }),
        }),
      );
    });
  });

  // ─── invoiceOrder (S07.04b) — baixa estoque após picking concluído ────────

  describe('invoiceOrder', () => {
    it('deve lançar BadRequestException quando OV não está READY_TO_INVOICE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValueOnce({
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
        pickingOrder: null,
        items: [],
      });
      await expect(service.invoiceOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
    });

    it('deve lançar BadRequestException quando picking não está DONE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: { status: 'IN_PROGRESS' },
      });
      await expect(service.invoiceOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
      await expect(service.invoiceOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(/Picking não concluído/);
    });

    it('deve permitir faturamento sem picking order quando WMS desativado (#220)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: null,
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
        customer: null,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.invoiceOrder('so-1', 'co-1', userContext('user-1'));
      expect(result.status).toBe(SalesOrderStatus.INVOICED);
    });

    // #498 (auditoria item 1): sem regra fiscal o Faturar falha ANTES de
    // consumir estoque, com mensagem orientada — fim do fallback genérico
    it('bloqueia o faturamento quando não há regra fiscal para a operação', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: { status: 'DONE' },
        company: { state: 'PR' },
        customer: { state: 'SC' },
        items: [{ id: 'si-1', productId: 'p-1', quantity: 1, unitPrice: 100, product: { ncm: '87163900', type: 'FINISHED_GOOD' } }],
      });
      mockTaxCalc.findBestRule.mockResolvedValue(null);

      await expect(service.invoiceOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(
        /Nenhuma regra fiscal cadastrada para VENDA_INTERESTADUAL PR→SC/,
      );
      // nada de efeito colateral: estoque intacto
      expect(mockStockService.consumeReserved).not.toHaveBeenCalled();
    });

    it('deve baixar reservado, criar StockMovement EXIT, mudar para INVOICED e emitir evento', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
        pickingOrder: { status: 'DONE' },
      });
      const invoicedOrder = {
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
        invoicedAt: new Date(),
        items: [{ productId: 'p-1', quantity: 5, unitPrice: 100 }],
        customer: null,
        warehouse: {},
      };
      mockPrisma.salesOrder.update.mockResolvedValue(invoicedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.invoiceOrder('so-1', 'co-1', userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.INVOICED);

      expect(mockStockService.consumeReserved).toHaveBeenCalledWith(
        'wh-1', 'p-1', 5, 'co-1',
        expect.stringContaining('Faturamento'), 'user-1', mockPrisma,
      );

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        SALE_INVOICED_EVENT,
        expect.objectContaining({ salesOrderId: 'so-1', warehouseId: 'wh-1' }),
      );
    });
  });

  // ─── returnOrder (S07.06) ─────────────────────────────────────────────────

  describe('returnOrder', () => {
    it('deve lançar BadRequestException quando OV não está INVOICED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder); // DRAFT
      await expect(
        service.returnOrder('so-1', 'co-1', { reason: 'Defeito' }, userContext('user-1')),
      ).rejects.toThrow(BadRequestException);
    });

    it('deve criar StockMovement IN e mudar status para RETURNED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(null);
      const returnedOrder = { ...baseOrder, status: SalesOrderStatus.RETURNED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(returnedOrder);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.returnOrder('so-1', 'co-1', { reason: 'Produto com defeito' }, userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.RETURNED);
      expect(mockStockService.returnStock).toHaveBeenCalledWith(
        'wh-1', 'p-1', 5, 'co-1',
        expect.stringContaining('Devolução'), 'user-1', mockPrisma,
      );
    });

    it('deve cancelar CR (conta a receber) vinculada (#178)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.financialEntry.findMany.mockResolvedValue([
        { id: 'fe-1', status: 'OPEN', salesOrderId: 'so-1' },
      ]);
      mockPrisma.financialEntry.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(null);
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RETURNED,
        items: [],
        customer: null,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.returnOrder('so-1', 'co-1', { reason: 'Defeito' }, userContext('user-1'));

      expect(mockPrisma.financialEntry.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['fe-1'] } },
        data: { status: 'CANCELLED' },
      });
    });

    it('não deve cancelar CR já paga (requer crédito manual)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.financialEntry.findMany.mockResolvedValue([
        { id: 'fe-1', status: 'PAID', salesOrderId: 'so-1' },
      ]);
      mockPrisma.fiscalDocument.findFirst.mockResolvedValue(null);
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RETURNED,
        items: [],
        customer: null,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.returnOrder('so-1', 'co-1', { reason: 'Defeito' }, userContext('user-1'));

      // CR PAID não é cancelada — apenas logado
      expect(mockPrisma.financialEntry.updateMany).not.toHaveBeenCalled();
    });

    it('#747: delega o lado fiscal ao SALE_RETURNED (listener cancela ou emite devolução) e não toca o FiscalDocument inline', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RETURNED,
        items: [],
        customer: null,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});
      mockPrisma.financialEntry.updateMany.mockResolvedValue({});

      await service.returnOrder(
        'so-1',
        'co-1',
        { reason: 'Defeito', justificativa: 'Devolução por defeito de fabricação confirmado' },
        userContext('user-1'),
      );

      // O returnOrder NÃO mexe mais no documento fiscal (antes marcava
      // CANCELLED no banco sem cancelar na SEFAZ) — quem age é o FiscalListener
      expect(mockPrisma.fiscalDocument.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'sales.order.returned',
        expect.objectContaining({
          companyId: 'co-1',
          salesOrderId: 'so-1',
          reason: 'Devolução por defeito de fabricação confirmado',
        }),
      );
    });

    it('#747: sem justificativa, o reason da devolução segue no evento', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      mockPrisma.stockBalance.update.mockResolvedValue({});
      mockPrisma.stockMovement.create.mockResolvedValue({});
      mockPrisma.financialEntry.findFirst.mockResolvedValue(null);
      mockPrisma.salesOrder.update.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RETURNED,
        items: [],
        customer: null,
        warehouse: {},
      });
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.returnOrder('so-1', 'co-1', { reason: 'Defeito' }, userContext('user-1'));

      expect(mockPrisma.fiscalDocument.update).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'sales.order.returned',
        expect.objectContaining({ salesOrderId: 'so-1', reason: 'Defeito' }),
      );
    });
  });

  // ─── cancelOrder (S07.05) ─────────────────────────────────────────────────

    describe('cancelOrder', () => {
    it('estorna cartões autorizados no TEF após cancelar (#596) e falha de TEF não desfaz o cancelamento', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      await service.cancelOrder('so-1', 'co-1', userContext('user-1'));
      expect(mockPaymentAuth.voidCardPayments).toHaveBeenCalledWith('so-1', 'co-1');

      mockPaymentAuth.voidCardPayments.mockRejectedValueOnce(new Error('TEF offline'));
      const result = await service.cancelOrder('so-1', 'co-1', userContext('user-1'));
      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
    });

    it('deve lançar BadRequestException para OV INVOICED (usar devolução)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.INVOICED,
      });
      await expect(service.cancelOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
      await expect(service.cancelOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(/devolução/);
    });

    it('deve lançar BadRequestException para OV já cancelada', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.CANCELLED,
      });
      await expect(service.cancelOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(BadRequestException);
    });

    it('deve cancelar OV em DRAFT sem alterar estoque', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(baseOrder);
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', userContext('user-1'));
      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockPrisma.stockBalance.update).not.toHaveBeenCalled();
    });

    it('deve devolver reservado para disponível ao cancelar OV RESERVED', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.RESERVED,
      });
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockStockService.releaseBalance).toHaveBeenCalledWith('wh-1', 'p-1', 5, mockPrisma);
    });

    it('deve devolver reservado para disponível ao cancelar OV AWAITING_PICKING', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.AWAITING_PICKING,
      });
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockStockService.releaseBalance).toHaveBeenCalledWith('wh-1', 'p-1', 5, mockPrisma);
    });

    it('deve devolver reservado para disponível ao cancelar OV READY_TO_INVOICE', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue({
        ...baseOrder,
        status: SalesOrderStatus.READY_TO_INVOICE,
      });
      const cancelled = { ...baseOrder, status: SalesOrderStatus.CANCELLED, items: [], customer: null, warehouse: {} };
      mockPrisma.salesOrder.update.mockResolvedValue(cancelled);
      mockPrisma.auditLog.create.mockResolvedValue({});

      const result = await service.cancelOrder('so-1', 'co-1', userContext('user-1'));

      expect(result.status).toBe(SalesOrderStatus.CANCELLED);
      expect(mockStockService.releaseBalance).toHaveBeenCalledWith('wh-1', 'p-1', 5, mockPrisma);
    });
  });

  // ─── #347-B: escopo por filial em vendas ──────────────────────────────────

  describe('escopo por filial (#347-B)', () => {
    const escopoFilial = {
      level: 'BRANCH' as const,
      branchIds: ['br-1'],
      warehouseIds: ['wh-1', 'wh-2'],
      userId: 'user-1',
    };

    it('COMPANY: findAll não adiciona filtro de depósito (comportamento de sempre)', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll('co-1', {}, userContext('user-1'));
      const where = mockPrisma.salesOrder.findMany.mock.calls[0][0].where;
      expect(where.warehouseId).toBeUndefined();
    });

    it('SYSTEM (chamada interna explícita): não resolve escopo e não filtra', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll('co-1', {}, SYSTEM_CONTEXT);
      expect(mockPermissions.getUserScope).not.toHaveBeenCalled();
      const where = mockPrisma.salesOrder.findMany.mock.calls[0][0].where;
      expect(where.warehouseId).toBeUndefined();
    });

    it('BRANCH: findAll recorta pelos depósitos das filiais do usuário', async () => {
      mockPermissions.getUserScope.mockResolvedValue(escopoFilial);
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll('co-1', {}, userContext('user-1'));
      const where = mockPrisma.salesOrder.findMany.mock.calls[0][0].where;
      expect(where.warehouseId).toEqual({ in: ['wh-1', 'wh-2'] });
      // multiempresa: o recorte por filial NÃO substitui o isolamento por
      // empresa — o companyId continua no where, sempre.
      expect(where.companyId).toBe('co-1');
    });

    it('BRANCH: findOne de venda fora do escopo responde 404 (não revela existência)', async () => {
      mockPermissions.getUserScope.mockResolvedValue(escopoFilial);
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.findOne('so-outra-filial', 'co-1', userContext('user-1'))).rejects.toThrow(
        NotFoundException,
      );
      const where = mockPrisma.salesOrder.findFirst.mock.calls[0][0].where;
      expect(where.warehouseId).toEqual({ in: ['wh-1', 'wh-2'] });
    });

    it('BRANCH: criar venda em depósito de outra filial é 403 com mensagem clara', async () => {
      mockPermissions.getUserScope.mockResolvedValue(escopoFilial);
      await expect(
        service.createOrder(
          { warehouseId: 'wh-de-outra-filial', items: [] } as any,
          'co-1',
          userContext('user-1'),
        ),
      ).rejects.toThrow(/fora do escopo da sua filial/);
      expect(mockPrisma.salesOrder.create).not.toHaveBeenCalled();
    });

    it('BRANCH: balcão não lista chassis de depósito de outra filial', async () => {
      mockPermissions.getUserScope.mockResolvedValue(escopoFilial);
      await expect(
        service.listCounterSerials('co-1', 'p-1', 'wh-de-outra-filial', userContext('user-1')),
      ).rejects.toThrow(/fora do escopo/);
      expect(mockPrisma.serialNumber.findMany).not.toHaveBeenCalled();
    });

    it('BRANCH: mutações por id (reservar) enxergam a venda pelo recorte — fora dele, 404', async () => {
      mockPermissions.getUserScope.mockResolvedValue(escopoFilial);
      mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
      await expect(service.reserveOrder('so-1', 'co-1', userContext('user-1'))).rejects.toThrow(
        NotFoundException,
      );
      const where = mockPrisma.salesOrder.findFirst.mock.calls[0][0].where;
      expect(where.warehouseId).toEqual({ in: ['wh-1', 'wh-2'] });
    });

    it('BRANCH sem depósito vinculado é fail-closed: vê lista vazia, não a empresa', async () => {
      mockPermissions.getUserScope.mockResolvedValue({ ...escopoFilial, warehouseIds: [] });
      mockPrisma.salesOrder.findMany.mockResolvedValue([]);
      await service.findAll('co-1', {}, userContext('user-1'));
      const where = mockPrisma.salesOrder.findMany.mock.calls[0][0].where;
      expect(where.warehouseId).toEqual({ in: [] });
    });
  });

});
