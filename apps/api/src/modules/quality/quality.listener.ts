import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InspectionType } from '@prisma/client';
import {
  GOODS_RECEIVED_EVENT,
  GoodsReceivedEvent,
} from '../stock/events/goods-received.event';
import { QualityService } from './quality.service';

export { GOODS_RECEIVED_EVENT, GoodsReceivedEvent };

@Injectable()
export class QualityListener {
  constructor(private readonly qualityService: QualityService) {}

  @OnEvent(GOODS_RECEIVED_EVENT)
  async handleGoodsReceived(event: GoodsReceivedEvent) {
    await this.qualityService.createInspection(event.companyId, {
      type: InspectionType.RECEIVING,
      goodsReceiptId: event.goodsReceiptId,
      notes: 'Inspeção automática de recebimento',
    });
  }
}
