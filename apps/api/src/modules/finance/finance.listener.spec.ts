import { Test, TestingModule } from '@nestjs/testing';
import { FinanceListener } from './finance.listener';
import { FinanceService } from './finance.service';
import { SaleConfirmedEvent } from '../sales/events/sale-confirmed.event';
import { GoodsReceivedEvent } from '../stock/events/goods-received.event';

const mockFinanceService = {
  createReceivableForSale: jest.fn(),
  createPayableForReceipt: jest.fn(),
};

describe('FinanceListener', () => {
  let listener: FinanceListener;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceListener,
        { provide: FinanceService, useValue: mockFinanceService },
      ],
    }).compile();

    listener = module.get<FinanceListener>(FinanceListener);
    jest.clearAllMocks();
  });

  describe('onSaleConfirmed', () => {
    it('deve criar CR com o total da venda', async () => {
      const event = new SaleConfirmedEvent('co-1', 'u-1', 'so-1', 'wh-1', [
        { productId: 'p-1', quantity: 2, unitPrice: 100 },
        { productId: 'p-2', quantity: 1, unitPrice: 50 },
      ]);

      mockFinanceService.createReceivableForSale.mockResolvedValue(undefined);

      await listener.onSaleConfirmed(event);

      expect(mockFinanceService.createReceivableForSale).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'co-1',
          salesOrderId: 'so-1',
          amount: 250, // 2*100 + 1*50
        }),
      );
    });

    it('deve absorver erros sem propagar exceção', async () => {
      const event = new SaleConfirmedEvent('co-1', 'u-1', 'so-1', 'wh-1', [
        { productId: 'p-1', quantity: 1, unitPrice: 100 },
      ]);

      mockFinanceService.createReceivableForSale.mockRejectedValue(new Error('DB error'));

      await expect(listener.onSaleConfirmed(event)).resolves.not.toThrow();
    });
  });

  describe('onGoodsReceived', () => {
    it('deve criar CP com o total do recebimento', async () => {
      const event = new GoodsReceivedEvent('co-1', 'u-1', 'po-1', 'gr-1', 'wh-1', [
        { productId: 'p-1', qtyReceived: 10, unitCost: 45 },
      ]);

      mockFinanceService.createPayableForReceipt.mockResolvedValue(undefined);

      await listener.onGoodsReceived(event);

      expect(mockFinanceService.createPayableForReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'co-1',
          purchaseOrderId: 'po-1',
          goodsReceiptId: 'gr-1',
          amount: 450, // 10 * 45
        }),
      );
    });

    it('deve absorver erros sem propagar exceção', async () => {
      const event = new GoodsReceivedEvent('co-1', 'u-1', 'po-1', 'gr-1', 'wh-1', [
        { productId: 'p-1', qtyReceived: 5, unitCost: 20 },
      ]);

      mockFinanceService.createPayableForReceipt.mockRejectedValue(new Error('DB error'));

      await expect(listener.onGoodsReceived(event)).resolves.not.toThrow();
    });
  });
});
