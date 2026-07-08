import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentAuthStatus, PaymentMethod } from '@prisma/client';
import { PaymentAuthorizationService } from './payment-authorization.service';
import { PAYMENT_PORT } from './payment.port';
import { PrismaService } from '../../prisma/prisma.service';

const mockPrisma = {
  salesOrder: { findFirst: jest.fn() },
  salesPayment: { update: jest.fn(), findMany: jest.fn() },
  auditLog: { create: jest.fn() },
};

const port = { name: 'mock', authorize: jest.fn(), voidPayment: jest.fn() };

function card(overrides: Record<string, any> = {}) {
  return {
    id: 'sp-1',
    method: PaymentMethod.CARTAO_CREDITO,
    amount: 8000,
    installments: 4,
    brand: 'VISA',
    authStatus: PaymentAuthStatus.PENDING,
    nsu: null,
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
        { provide: PAYMENT_PORT, useValue: port },
      ],
    }).compile();
    service = module.get(PaymentAuthorizationService);
    jest.clearAllMocks();
    mockPrisma.auditLog.create.mockResolvedValue({});
    mockPrisma.salesPayment.update.mockResolvedValue({});
  });

  it('autoriza cartão e grava authCode/NSU/AUTHORIZED', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [card()] });
    port.authorize.mockResolvedValue({ authorized: true, authCode: '123456', nsu: '987654321', brand: 'VISA' });

    const r = await service.authorizeCardPayments('so-1', 'co-1');

    expect(r.authorized).toBe(1);
    expect(mockPrisma.salesPayment.update).toHaveBeenCalledWith({
      where: { id: 'sp-1' },
      data: expect.objectContaining({
        authStatus: PaymentAuthStatus.AUTHORIZED,
        authCode: '123456',
        nsu: '987654321',
      }),
    });
  });

  it('negada → marca DENIED e lança BadRequest', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({ id: 'so-1', payments: [card()] });
    port.authorize.mockResolvedValue({ authorized: false, declineReason: 'Sem saldo' });

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

    expect(port.authorize).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
  });

  it('venda só com PIX → nada a autorizar', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue({
      id: 'so-1',
      payments: [{ id: 'sp-pix', method: PaymentMethod.PIX, amount: 100, installments: 1, authStatus: 'PENDING' }],
    });

    const r = await service.authorizeCardPayments('so-1', 'co-1');
    expect(r.authorized).toBe(0);
    expect(port.authorize).not.toHaveBeenCalled();
  });

  it('venda inexistente → NotFound', async () => {
    mockPrisma.salesOrder.findFirst.mockResolvedValue(null);
    await expect(service.authorizeCardPayments('x', 'co-1')).rejects.toThrow(NotFoundException);
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
