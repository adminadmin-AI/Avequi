import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentAuthStatus, PaymentGateway, PaymentMethod } from '@prisma/client';
import { PaymentAuthorizationService } from './payment-authorization.service';
import { PaymentPortRegistry } from './payment-port.registry';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  salesOrder: { findFirst: jest.fn() },
  salesPayment: { update: jest.fn(), findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

const mockPort = { name: 'mock', authorize: jest.fn(), voidPayment: jest.fn() };
const getnetPort = { name: 'getnet', authorize: jest.fn(), voidPayment: jest.fn() };

/** Registry fake: MOCK/default → mockPort; GETNET → getnetPort. */
const registry = {
  resolve: jest.fn((gw?: PaymentGateway | null) =>
    gw === PaymentGateway.GETNET ? getnetPort : mockPort,
  ),
  gatewayOf: jest.fn((port: { name: string }) =>
    port.name === 'getnet' ? PaymentGateway.GETNET : PaymentGateway.MOCK,
  ),
  envDefault: jest.fn(() => mockPort),
};

function card(overrides: Record<string, any> = {}) {
  return {
    id: 'sp-1',
    method: PaymentMethod.CARTAO_CREDITO,
    amount: 8000,
    installments: 4,
    brand: 'VISA',
    authStatus: PaymentAuthStatus.PENDING,
    nsu: null,
    acquirer: null,
    ...overrides,
  };
}

describe('PaymentAuthorizationService (#596)', () => {
  let service: PaymentAuthorizationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PaymentAuthorizationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PaymentPortRegistry, useValue: registry },
      ],
    }).compile();
    service = module.get(PaymentAuthorizationService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.salesPayment.update.mockResolvedValue({});
  });

  it('autoriza cartão e grava authCode/NSU/providerRef/authGateway/AUTHORIZED', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [card()] });
    mockPort.authorize.mockResolvedValue({
      authorized: true,
      authCode: '123456',
      nsu: '987654321',
      brand: 'VISA',
      providerRef: 'MOCK-1',
    });

    const r = await service.authorizeCardPayments('so-1', 'co-1');

    expect(r.authorized).toBe(1);
    expect(mockPrisma.salesPayment.update).toHaveBeenCalledWith({
      where: { id: 'sp-1' },
      data: expect.objectContaining({
        authStatus: PaymentAuthStatus.AUTHORIZED,
        authCode: '123456',
        nsu: '987654321',
        providerRef: 'MOCK-1',
        authGateway: PaymentGateway.MOCK,
      }),
    });
  });

  it('multi-adquirente: cada forma autoriza no gateway da SUA adquirente', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [
        card({ id: 'sp-inf', acquirer: { gateway: PaymentGateway.MOCK } }),
        card({ id: 'sp-get', acquirer: { gateway: PaymentGateway.GETNET } }),
      ],
    });
    mockPort.authorize.mockResolvedValue({ authorized: true, authCode: '111111', nsu: '1' });
    getnetPort.authorize.mockResolvedValue({ authorized: true, authCode: '222222', nsu: '2' });

    const r = await service.authorizeCardPayments('so-1', 'co-1');

    expect(r.authorized).toBe(2);
    expect(mockPort.authorize).toHaveBeenCalledTimes(1);
    expect(getnetPort.authorize).toHaveBeenCalledTimes(1);
    expect(mockPrisma.salesPayment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sp-get' },
        data: expect.objectContaining({ authGateway: PaymentGateway.GETNET }),
      }),
    );
  });

  it('forma sem adquirente cai no default do ambiente (registry.resolve(undefined))', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [card()] });
    mockPort.authorize.mockResolvedValue({ authorized: true, authCode: '1', nsu: '1' });

    await service.authorizeCardPayments('so-1', 'co-1');

    expect(registry.resolve).toHaveBeenCalledWith(undefined);
    expect(mockPort.authorize).toHaveBeenCalledTimes(1);
  });

  it('negada → marca DENIED e lança BadRequest', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [card()] });
    mockPort.authorize.mockResolvedValue({ authorized: false, declineReason: 'Sem saldo' });

    await expect(service.authorizeCardPayments('so-1', 'co-1')).rejects.toThrow(BadRequestException);
    expect(mockPrisma.salesPayment.update).toHaveBeenCalledWith({
      where: { id: 'sp-1' },
      data: expect.objectContaining({ authStatus: PaymentAuthStatus.DENIED }),
    });
  });

  it('idempotente: forma já AUTHORIZED não reprocessa (sem cobrança dupla)', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [card({ authStatus: PaymentAuthStatus.AUTHORIZED })],
    });

    const r = await service.authorizeCardPayments('so-1', 'co-1');

    expect(mockPort.authorize).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it('venda só com PIX → nada a autorizar', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [{ id: 'sp-pix', method: PaymentMethod.PIX, amount: 100, installments: 1, authStatus: 'PENDING' }],
    });

    const r = await service.authorizeCardPayments('so-1', 'co-1');
    expect(r.authorized).toBe(0);
    expect(mockPort.authorize).not.toHaveBeenCalled();
  });

  it('venda inexistente → NotFound', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
    await expect(service.authorizeCardPayments('x', 'co-1')).rejects.toThrow(NotFoundException);
  });

  describe('voidCardPayments', () => {
    it('estorna pelo gateway que AUTORIZOU (authGateway), com providerRef', async () => {
      mockPrisma.salesPayment.findMany.mockResolvedValue([
        card({
          id: 'sp-get',
          authStatus: PaymentAuthStatus.AUTHORIZED,
          authGateway: PaymentGateway.GETNET,
          providerRef: 'GET-42',
          nsu: '2',
        }),
      ]);
      getnetPort.voidPayment.mockResolvedValue(undefined);

      await service.voidCardPayments('so-1', 'co-1');

      expect(registry.resolve).toHaveBeenCalledWith(PaymentGateway.GETNET);
      expect(getnetPort.voidPayment).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRef: 'sp-get', providerRef: 'GET-42' }),
      );
      expect(mockPrisma.salesPayment.update).toHaveBeenCalledWith({
        where: { id: 'sp-get' },
        data: expect.objectContaining({
          authStatus: PaymentAuthStatus.PENDING,
          providerRef: null,
          authGateway: null,
        }),
      });
    });

    it('falha no estorno não interrompe os demais (log e segue)', async () => {
      mockPrisma.salesPayment.findMany.mockResolvedValue([
        card({ id: 'sp-a', authStatus: PaymentAuthStatus.AUTHORIZED, authGateway: PaymentGateway.MOCK }),
        card({ id: 'sp-b', authStatus: PaymentAuthStatus.AUTHORIZED, authGateway: PaymentGateway.MOCK }),
      ]);
      mockPort.voidPayment.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);

      await service.voidCardPayments('so-1', 'co-1');

      expect(mockPort.voidPayment).toHaveBeenCalledTimes(2);
      // só o segundo volta a PENDING
      expect(mockPrisma.salesPayment.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasUnauthorizedCard (gate)', () => {
    it('cartão PENDING → bloqueia', () => {
      expect(
        PaymentAuthorizationService.hasUnauthorizedCard([card({ authStatus: PaymentAuthStatus.PENDING })]),
      ).toBe(true);
    });
    it('cartão AUTHORIZED + PIX → libera', () => {
      expect(
        PaymentAuthorizationService.hasUnauthorizedCard([
          card({ authStatus: PaymentAuthStatus.AUTHORIZED }),
          { method: PaymentMethod.PIX, authStatus: PaymentAuthStatus.PENDING },
        ]),
      ).toBe(false);
    });
  });
});
