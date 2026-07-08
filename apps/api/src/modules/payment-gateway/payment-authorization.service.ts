import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentAuthStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AcquirerService } from '../acquirer/acquirer.service';
import { isCardMethod } from '../acquirer/payment-classification';
import { PAYMENT_PORT, PaymentPort } from './payment.port';

/**
 * Orquestra a autorização de cartão (#596): envia cada forma de cartão da venda
 * ao TEF/gateway ativo, grava authStatus/authCode/NSU no SalesPayment e estorna
 * quando a venda é cancelada antes de faturar. É o gate do faturamento (#595).
 */
@Injectable()
export class PaymentAuthorizationService {
  private readonly logger = new Logger(PaymentAuthorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PAYMENT_PORT) private readonly port: PaymentPort,
  ) {}

  /**
   * Autoriza as formas de cartão PENDENTES da venda. Idempotente: formas já
   * AUTHORIZED não são reprocessadas (evita cobrança dupla). Retorna o resumo.
   */
  async authorizeCardPayments(salesOrderId: string, companyId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, companyId },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException(`Venda ${salesOrderId} não encontrada`);

    const cardPayments = order.payments.filter((p) => isCardMethod(p.method));
    if (cardPayments.length === 0) {
      return { authorized: 0, denied: 0, skipped: 0, message: 'Sem formas de cartão' };
    }

    let authorized = 0;
    let denied = 0;
    let skipped = 0;
    const declines: string[] = [];

    for (const p of cardPayments) {
      if (p.authStatus === PaymentAuthStatus.AUTHORIZED) {
        skipped++;
        continue;
      }
      const modality = AcquirerService.modalityFor(p.method, p.installments);
      const result = await this.port.authorize({
        amount: Number(p.amount),
        installments: p.installments,
        modality: modality!,
        brand: p.brand ?? undefined,
        orderRef: salesOrderId,
        paymentRef: p.id,
      });

      if (result.authorized) {
        await this.prisma.salesPayment.update({
          where: { id: p.id },
          data: {
            authStatus: PaymentAuthStatus.AUTHORIZED,
            authCode: result.authCode ?? null,
            nsu: result.nsu ?? null,
            authorizedAt: new Date(),
            ...(result.brand && !p.brand ? { brand: result.brand.toUpperCase() } : {}),
          },
        });
        authorized++;
      } else {
        await this.prisma.salesPayment.update({
          where: { id: p.id },
          data: { authStatus: PaymentAuthStatus.DENIED, authorizedAt: new Date() },
        });
        denied++;
        declines.push(result.declineReason ?? 'negada');
      }
    }

    await this.prisma.auditLog.create({
      data: {
        companyId,
        entity: 'SalesPayment',
        action: 'AUTHORIZE_CARDS',
        payload: { salesOrderId, authorized, denied, skipped, port: this.port.name },
      },
    });

    if (denied > 0) {
      throw new BadRequestException(
        `Autorização de cartão negada (${denied}/${cardPayments.length}): ${declines.join('; ')}. ` +
          'Refaça a cobrança ou troque a forma de pagamento antes de faturar.',
      );
    }

    this.logger.log(`OV ${salesOrderId}: ${authorized} autorizada(s), ${skipped} já ok (${this.port.name})`);
    return { authorized, denied, skipped, message: 'Cartões autorizados' };
  }

  /** Estorna as autorizações de cartão da venda (cancelamento antes de faturar) */
  async voidCardPayments(salesOrderId: string, companyId: string): Promise<void> {
    const payments = await this.prisma.salesPayment.findMany({
      where: {
        salesOrder: { id: salesOrderId, companyId },
        authStatus: PaymentAuthStatus.AUTHORIZED,
      },
    });
    for (const p of payments.filter((p) => isCardMethod(p.method))) {
      try {
        await this.port.voidPayment({
          paymentRef: p.id,
          nsu: p.nsu ?? undefined,
          amount: Number(p.amount),
        });
        await this.prisma.salesPayment.update({
          where: { id: p.id },
          data: { authStatus: PaymentAuthStatus.PENDING, authCode: null, nsu: null, authorizedAt: null },
        });
      } catch (err) {
        this.logger.error(`Falha ao estornar pagamento ${p.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Há alguma forma de cartão ainda não autorizada? (gate do faturamento) */
  static hasUnauthorizedCard(payments: { method: any; authStatus: PaymentAuthStatus }[]): boolean {
    return payments.some((p) => isCardMethod(p.method) && p.authStatus !== PaymentAuthStatus.AUTHORIZED);
  }
}
