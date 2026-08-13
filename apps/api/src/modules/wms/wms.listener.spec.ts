import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SYSTEM_CONTEXT } from '../iam/scope';
import { SaleConfirmedEvent } from '../sales/events/sale-confirmed.event';
import { SalePickedEvent } from '../sales/events/sale-picked.event';
import { GoodsReceivedEvent } from '../stock/events/goods-received.event';
import { SalesService } from '../sales/sales.service';
import { WmsListener } from './wms.listener';
import { WmsService } from './wms.service';

/**
 * Testes do WmsListener (#729).
 *
 * Este listener nunca teve teste — e é justamente ele que decide o destino de
 * uma venda em depósito SEM WMS. O bug relatado na #729 ("venda trava em
 * AWAITING_PICKING") não se reproduziu: o desvio funciona. O que existia era
 * (a) um log que anunciava um estado errado, herdado de antes do #491, e
 * (b) um `catch` único que reportava qualquer falha como "falha ao criar
 * PickingOrder", inclusive quando o problema era o desvio.
 *
 * O que estes testes travam: o desvio continua acontecendo, a falha dele
 * aparece com identidade própria, e uma falha na criação da separação NÃO
 * dispara o desvio (senão uma venda com WMS pularia a separação de verdade).
 */

const mockWmsService = { createPickingOrder: jest.fn(), createReceivingOrder: jest.fn() };
const mockSalesService = { marcarSeparacaoConcluida: jest.fn() };

/** Eventos estruturados emitidos como erro, já desempacotados do JSON. */
function errosEstruturados(spy: jest.SpyInstance): any[] {
  return spy.mock.calls
    .map(([msg]) => msg)
    .filter((msg): msg is string => typeof msg === 'string')
    .map((msg) => {
      try {
        return JSON.parse(msg);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

describe('WmsListener', () => {
  let listener: WmsListener;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;

  const venda = new SaleConfirmedEvent('empresa-1', 'user-1', 'venda-1', 'deposito-1', [
    { productId: 'prod-1', quantity: 1, unitPrice: 3000 },
  ]);

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WmsListener,
        { provide: WmsService, useValue: mockWmsService },
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    listener = module.get<WmsListener>(WmsListener);
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    error.mockRestore();
    log.mockRestore();
  });

  describe('venda confirmada em depósito SEM WMS (#220)', () => {
    it('conclui a separação automaticamente quando não há separação a criar', async () => {
      mockWmsService.createPickingOrder.mockResolvedValue(false);
      mockSalesService.marcarSeparacaoConcluida.mockResolvedValue({});

      await listener.onSaleConfirmed(venda);

      expect(mockSalesService.marcarSeparacaoConcluida).toHaveBeenCalledWith(
        'venda-1',
        SYSTEM_CONTEXT,
      );
      expect(errosEstruturados(error)).toHaveLength(0);
    });

    it('falha do desvio vira evento próprio, não se disfarça de falha do picking', async () => {
      mockWmsService.createPickingOrder.mockResolvedValue(false);
      mockSalesService.marcarSeparacaoConcluida.mockRejectedValue(new Error('banco fora'));

      // Não relança: é handler de evento fire-and-forget.
      await expect(listener.onSaleConfirmed(venda)).resolves.toBeUndefined();

      const [evento] = errosEstruturados(error);
      expect(evento).toEqual({
        event: 'sales_non_wms_advance_failed',
        salesOrderId: 'venda-1',
        warehouseId: 'deposito-1',
        error: 'banco fora',
      });
    });
  });

  describe('venda confirmada em depósito COM WMS', () => {
    it('não mexe no status: quem avança é a conclusão do picking', async () => {
      mockWmsService.createPickingOrder.mockResolvedValue(true);

      await listener.onSaleConfirmed(venda);

      expect(mockSalesService.marcarSeparacaoConcluida).not.toHaveBeenCalled();
      expect(errosEstruturados(error)).toHaveLength(0);
    });

    it('falha ao criar a separação NÃO dispara o desvio — a venda espera o picking', async () => {
      mockWmsService.createPickingOrder.mockRejectedValue(new Error('indisponível'));

      await expect(listener.onSaleConfirmed(venda)).resolves.toBeUndefined();

      // A regressão perigosa: pular a separação num depósito que TEM WMS.
      expect(mockSalesService.marcarSeparacaoConcluida).not.toHaveBeenCalled();
      const [evento] = errosEstruturados(error);
      expect(evento.event).toBe('wms_picking_order_failed');
      expect(evento.salesOrderId).toBe('venda-1');
    });
  });

  describe('picking concluído', () => {
    it('conclui a separação da venda', async () => {
      mockSalesService.marcarSeparacaoConcluida.mockResolvedValue({});

      await listener.onSalePicked(new SalePickedEvent('empresa-1', 'venda-1', 'sep-1', 'deposito-1'));

      expect(mockSalesService.marcarSeparacaoConcluida).toHaveBeenCalledWith(
        'venda-1',
        SYSTEM_CONTEXT,
      );
    });

    it('falha deixa rastro estruturado e não derruba o handler', async () => {
      mockSalesService.marcarSeparacaoConcluida.mockRejectedValue(new Error('conflito de estado'));

      await expect(
        listener.onSalePicked(new SalePickedEvent('empresa-1', 'venda-1', 'sep-1', 'deposito-1')),
      ).resolves.toBeUndefined();

      expect(errosEstruturados(error)[0].event).toBe('sales_picked_advance_failed');
    });
  });

  describe('recebimento de mercadoria', () => {
    it('falha ao criar recebimento não derruba o handler', async () => {
      mockWmsService.createReceivingOrder.mockRejectedValue(new Error('x'));

      await expect(
        listener.onGoodsReceived({ goodsReceiptId: 'gr-1' } as GoodsReceivedEvent),
      ).resolves.toBeUndefined();
    });
  });
});
