import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { SalesOrderStatus } from '@prisma/client';
import { AcquirerService } from '../acquirer/acquirer.service';
import { DiscountPolicyService } from './discount-policy.service';
import { PaymentAuthorizationService } from '../payment-gateway/payment-authorization.service';
import { PermissionService } from '../iam/permission.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesService } from './sales.service';
import { StockService } from '../stock/stock.service';
import { TaxCalculationService } from '../tax/tax-calculation.service';
import { companyScope, userContext } from '../iam/scope';

/**
 * Chassi escolhido na conferência da carga — #729, parte 2.
 *
 * O caso real: depósito SEM WMS não tem separação, e a separação era o único
 * lugar que amarrava um chassi à venda. Resultado: item rastreável chegava à
 * conferência sem chassi e não havia como faturar. A conferência passa a ser o
 * ponto de escolha — é onde a fábrica sabe qual unidade está subindo no
 * caminhão (decisão de produto do Rafael, 13/08).
 *
 * O que estes testes protegem, além do caminho feliz: que o fluxo COM WMS
 * continue apenas CONFERINDO (nunca escolhendo), e que duas conferências
 * simultâneas jamais fiquem donas do mesmo reboque.
 */

const reboque = { id: 'p-reboque', name: 'Reboque Carga 1,50m', tracksSerial: true };
const parafuso = { id: 'p-parafuso', name: 'Parafuso', tracksSerial: false };

function pedidoEmConferencia(overrides: any = {}) {
  return {
    id: 'so-1',
    companyId: 'co-1',
    warehouseId: 'wh-1',
    status: SalesOrderStatus.AWAITING_CONFERENCE,
    customer: null,
    items: [
      {
        id: 'si-1',
        productId: reboque.id,
        quantity: 1,
        product: reboque,
        serialNumberId: null,
        serialNumber: null,
      },
    ],
    ...overrides,
  };
}

/** Chassi disponível, do produto e do depósito da venda. */
function chassiDisponivel(overrides: any = {}) {
  return {
    id: 'sn-1',
    serial: 'SN20010',
    productId: reboque.id,
    warehouseId: 'wh-1',
    status: 'IN_STOCK',
    salesOrderId: null,
    ...overrides,
  };
}

const mockPrisma: any = {
  salesOrder: { findFirst: jest.fn(), update: jest.fn() },
  saleItem: { update: jest.fn() },
  serialNumber: { findFirst: jest.fn(), updateMany: jest.fn() },
  product: { findMany: jest.fn().mockResolvedValue([]) },
  customer: { findFirst: jest.fn() },
  financialEntry: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn() },
  auditLog: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockPermissions = { getUserScope: jest.fn(), hasAnyPermission: jest.fn() };

describe('Conferência escolhe o chassi quando não há WMS (#729)', () => {
  let service: SalesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: StockService, useValue: {} },
        { provide: TaxCalculationService, useValue: { findBestRule: jest.fn() } },
        { provide: DiscountPolicyService, useValue: { assertWithinLimit: jest.fn() } },
        { provide: AcquirerService, useValue: { resolveFee: jest.fn() } },
        { provide: PaymentAuthorizationService, useValue: {} },
        { provide: PermissionService, useValue: mockPermissions },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    jest.clearAllMocks();
    mockPermissions.getUserScope.mockResolvedValue(companyScope('user-1'));
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
    mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.salesOrder.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ ...pedidoEmConferencia(), ...data }),
    );
  });

  const conferir = (items: any[]) =>
    service.conferOrder('so-1', 'co-1', { items }, userContext('user-1'));

  describe('sem WMS — a conferência escolhe', () => {
    it('vincula o chassi ao item e o reserva para a venda', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(chassiDisponivel());

      const res = await conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]);

      expect(res.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
      // reserva atômica: só move o que ainda está livre
      expect(mockPrisma.serialNumber.updateMany).toHaveBeenCalledWith({
        where: { id: 'sn-1', companyId: 'co-1', status: 'IN_STOCK', salesOrderId: null },
        data: { status: 'RESERVED_FOR_SALE', salesOrderId: 'so-1' },
      });
      // o item guarda o vínculo — é o que o gate do faturamento (#492) exige
      expect(mockPrisma.saleItem.update).toHaveBeenCalledWith({
        where: { id: 'si-1' },
        data: { serialNumberId: 'sn-1' },
      });
    });

    it('exige o chassi: sem ele a conferência não passa', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());

      await expect(conferir([{ saleItemId: 'si-1', quantity: 1 }])).rejects.toThrow(
        /informe o chassi que está saindo/,
      );
      expect(mockPrisma.serialNumber.updateMany).not.toHaveBeenCalled();
    });

    it('recusa chassi de outra empresa (busca escopada por companyId)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(null); // não existe DENTRO da empresa

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-de-outra' }]),
      ).rejects.toThrow(/não encontrado/);
      expect(mockPrisma.serialNumber.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sn-de-outra', companyId: 'co-1' } }),
      );
    });

    it('recusa chassi de produto diferente do vendido', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(
        chassiDisponivel({ productId: 'outro-produto' }),
      );

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(/não pertence ao produto/);
    });

    it('recusa chassi de outro depósito', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(chassiDisponivel({ warehouseId: 'wh-2' }));

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(/não está no depósito da venda/);
    });

    it('recusa chassi já vendido', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(chassiDisponivel({ status: 'SOLD' }));

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(/não está disponível/);
    });

    it('recusa chassi já reservado para outra venda', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(
        chassiDisponivel({ salesOrderId: 'so-outra' }),
      );

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(/já está vinculado a outra venda/);
    });

    it('recusa o mesmo chassi repetido em dois itens da mesma conferência', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(
        pedidoEmConferencia({
          items: [
            { id: 'si-1', productId: reboque.id, quantity: 1, product: reboque, serialNumberId: null },
            { id: 'si-2', productId: reboque.id, quantity: 1, product: reboque, serialNumberId: null },
          ],
        }),
      );

      await expect(
        conferir([
          { saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' },
          { saleItemId: 'si-2', quantity: 1, serialNumberId: 'sn-1' },
        ]),
      ).rejects.toThrow(/repetido na mesma conferência/);
    });

    it('exige 1 unidade por linha em item rastreável (um chassi por item)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(
        pedidoEmConferencia({
          items: [
            { id: 'si-1', productId: reboque.id, quantity: 2, product: reboque, serialNumberId: null },
          ],
        }),
      );

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 2, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(/1 unidade por linha/);
    });

    it('CORRIDA: se outra venda reservou entre a validação e a gravação, esta falha', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      // validação passa (leitura ainda mostra livre)…
      mockPrisma.serialNumber.findFirst.mockResolvedValue(chassiDisponivel());
      // …mas a gravação condicional não encontra mais o chassi livre
      mockPrisma.serialNumber.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(/não está mais disponível/);
      // e o pedido NÃO avança: a transação inteira cai
      expect(mockPrisma.salesOrder.update).not.toHaveBeenCalled();
    });
  });

  describe('com WMS — a conferência apenas confere', () => {
    const pedidoComSeparacao = pedidoEmConferencia({
      items: [
        {
          id: 'si-1',
          productId: reboque.id,
          quantity: 1,
          product: reboque,
          serialNumberId: 'sn-separado',
          serialNumber: { chassi: '9BG...0010' },
        },
      ],
    });

    it('chassi conferido igual ao separado: passa sem reservar nada de novo', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoComSeparacao);

      const res = await conferir([
        { saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-separado' },
      ]);

      expect(res.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
      // não reserva nem revincula: quem escolheu foi a separação
      expect(mockPrisma.serialNumber.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.saleItem.update).not.toHaveBeenCalled();
    });

    it('chassi conferido diferente do separado: divergência, como antes', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoComSeparacao);

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-outro' }]),
      ).rejects.toThrow(/não confere com o separado/);
    });
  });

  describe('itens sem rastreabilidade', () => {
    it('produto não rastreável continua conferindo sem chassi nenhum', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(
        pedidoEmConferencia({
          items: [
            { id: 'si-1', productId: parafuso.id, quantity: 10, product: parafuso, serialNumberId: null },
          ],
        }),
      );

      const res = await conferir([{ saleItemId: 'si-1', quantity: 10 }]);

      expect(res.status).toBe(SalesOrderStatus.READY_TO_INVOICE);
      expect(mockPrisma.serialNumber.updateMany).not.toHaveBeenCalled();
    });

    it('divergência de quantidade continua barrando a conferência', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(
        pedidoEmConferencia({
          items: [
            { id: 'si-1', productId: parafuso.id, quantity: 10, product: parafuso, serialNumberId: null },
          ],
        }),
      );

      await expect(conferir([{ saleItemId: 'si-1', quantity: 9 }])).rejects.toThrow(
        /conferido 9, esperado 10/,
      );
    });
  });

  describe('escopo e estado', () => {
    it('não confere venda fora do status de conferência', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(
        pedidoEmConferencia({ status: SalesOrderStatus.AWAITING_PICKING }),
      );

      await expect(
        conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('a busca do pedido continua recortada por empresa e filial (#347-B/#930)', async () => {
      mockPrisma.salesOrder.findFirst.mockResolvedValue(pedidoEmConferencia());
      mockPrisma.serialNumber.findFirst.mockResolvedValue(chassiDisponivel());

      await conferir([{ saleItemId: 'si-1', quantity: 1, serialNumberId: 'sn-1' }]);

      expect(mockPrisma.salesOrder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'so-1', companyId: 'co-1' }),
        }),
      );
      expect(mockPermissions.getUserScope).toHaveBeenCalledWith('user-1', 'co-1');
    });
  });
});
