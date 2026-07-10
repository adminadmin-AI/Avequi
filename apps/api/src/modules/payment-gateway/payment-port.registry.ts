import { Injectable, Logger } from '@nestjs/common';
import { PaymentGateway } from '@prisma/client';
import { GetnetAdapter } from './adapters/getnet.adapter';
import { InfinitePayAdapter } from './adapters/infinitepay.adapter';
import { MockPaymentAdapter } from './adapters/mock.adapter';
import { PaymentPort } from './payment.port';

/**
 * Registry multi-adquirente (#596): resolve o adapter de TEF/gateway pela
 * adquirente da forma de pagamento (`Acquirer.gateway`), permitindo
 * InfinitePay e Getnet (e futuras) coexistirem — cada loja/maquininha usa a
 * sua. Forma sem adquirente cai no default do ambiente (`PAYMENT_PORT`,
 * mesmo comportamento de antes do registry).
 *
 * Adicionar uma adquirente nova = novo adapter + uma linha no mapa + valor no
 * enum PaymentGateway (schema).
 */
@Injectable()
export class PaymentPortRegistry {
  private readonly logger = new Logger(PaymentPortRegistry.name);
  private readonly byGateway: Record<PaymentGateway, PaymentPort>;

  constructor(
    mock: MockPaymentAdapter,
    infinitepay: InfinitePayAdapter,
    getnet: GetnetAdapter,
  ) {
    this.byGateway = {
      [PaymentGateway.MOCK]: mock,
      [PaymentGateway.INFINITEPAY]: infinitepay,
      [PaymentGateway.GETNET]: getnet,
    };
  }

  /** Adapter da adquirente; sem gateway → default do ambiente. */
  resolve(gateway?: PaymentGateway | null): PaymentPort {
    if (gateway) return this.byGateway[gateway];
    return this.envDefault();
  }

  /** Enum do adapter (para persistir em SalesPayment.authGateway). */
  gatewayOf(port: PaymentPort): PaymentGateway {
    const entry = (Object.entries(this.byGateway) as [PaymentGateway, PaymentPort][]).find(
      ([, p]) => p === port,
    );
    return entry ? entry[0] : PaymentGateway.MOCK;
  }

  /** Default do ambiente (PAYMENT_PORT=mock|infinitepay|getnet; ausente → mock). */
  envDefault(): PaymentPort {
    const selected = (process.env.PAYMENT_PORT ?? 'mock').toLowerCase();
    const port = Object.values(this.byGateway).find((p) => p.name === selected);
    if (!port) {
      this.logger.warn(`PAYMENT_PORT="${selected}" desconhecido — usando mock`);
      return this.byGateway[PaymentGateway.MOCK];
    }
    return port;
  }
}
