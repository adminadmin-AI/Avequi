import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentAuthStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AcquirerService } from '../acquirer/acquirer.service';
import { isCardMethod } from '../acquirer/payment-classification';
import { PaymentPortRegistry } from './payment-port.registry';

/**
 * Orquestra a autorização de cartão (#596): envia cada forma de cartão da venda
 * ao TEF/gateway DA SUA ADQUIRENTE (multi-adquirente via registry), grava
 * authStatus/authCode/NSU/providerRef no SalesPayment e estorna quando a venda
 * é cancelada antes de faturar — sempre no gateway que AUTORIZOU (authGateway),
 * mesmo que a adquirente troque de gateway depois. É o gate do faturamento (#595).
 */
@Injectable()
export class PaymentAuthorizationService {
  private readonly logger = new Logger(PaymentAuthorizationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PaymentPortRegistry,
  ) {}

  /**
   * Autoriza as formas de cartão PENDENTES da venda. Idempotente: formas já
   * AUTHORIZED não são reprocessadas (evita cobrança dupla). Retorna o resumo.
   */
  async authorizeCardPayments(salesOrderId: string, companyId: string) {
    const order = await this.prisma.salesOrder.findFirst({
      where: { id: salesOrderId, companyId },
      include: { payments: { include: { acquirer: { select: { gateway: true } } } } },
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
    const portsUsed = new Set<string>();

    for (const p of cardPayments) {
      if (p.authStatus === PaymentAuthStatus.AUTHORIZED) {
        skipped++;
        continue;
      }
      // Multi-adquirente: cada forma autoriza no gateway da SUA adquirente
      const port = this.registry.resolve(p.acquirer?.gateway);
      portsUsed.add(port.name);
      const modality = AcquirerService.modalityFor(p.method, p.installments);
      const result = await port.authorize({
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
            providerRef: result.providerRef ?? null,
            authGateway: this.registry.gatewayOf(port),
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
        payload: { salesOrderId, authorized, denied, skipped, ports: [...portsUsed] },
      },
    });

    if (denied > 0) {
      throw new BadRequestException(
        `Autorização de cartão negada (${denied}/${cardPayments.length}): ${declines.join('; ')}. ` +
          'Refaça a cobrança ou troque a forma de pagamento antes de faturar.',
      );
    }

    this.logger.log(
      `OV ${salesOrderId}: ${authorized} autorizada(s), ${skipped} já ok (${[...portsUsed].join(', ') || 'nenhum port'})`,
    );
    return { authorized, denied, skipped, message: 'Cartões autorizados' };
  }

  /**
   * Estorna as autorizações de cartão da venda (cancelamento antes de faturar).
   * Roteia pelo gateway que AUTORIZOU (authGateway) — não pelo configurado na
   * adquirente hoje — para o estorno ir ao provider certo mesmo após troca.
   */
  async voidCardPayments(salesOrderId: string, companyId: string): Promise<void> {
    const payments = await this.prisma.salesPayment.findMany({
      where: {
        salesOrder: { id: salesOrderId, companyId },
        authStatus: PaymentAuthStatus.AUTHORIZED,
      },
    });
    for (const p of payments.filter((p) => isCardMethod(p.method))) {
      try {
        const port = this.registry.resolve(p.authGateway);
        await port.voidPayment({
          paymentRef: p.id,
          providerRef: p.providerRef ?? undefined,
          nsu: p.nsu ?? undefined,
          amount: Number(p.amount),
        });
        await this.prisma.salesPayment.update({
          where: { id: p.id },
          data: {
            authStatus: PaymentAuthStatus.PENDING,
            authCode: null,
            nsu: null,
            providerRef: null,
            authGateway: null,
            authorizedAt: null,
          },
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
