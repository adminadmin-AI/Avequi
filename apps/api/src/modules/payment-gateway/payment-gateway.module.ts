import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { GetnetAdapter } from './adapters/getnet.adapter';
import { InfinitePayAdapter } from './adapters/infinitepay.adapter';
import { MockPaymentAdapter } from './adapters/mock.adapter';
import { PaymentAuthorizationService } from './payment-authorization.service';
import { PaymentPortRegistry } from './payment-port.registry';

/**
 * Gateway de pagamento (#596) — MULTI-ADQUIRENTE. O adapter é resolvido POR
 * ADQUIRENTE (`Acquirer.gateway` → PaymentPortRegistry), permitindo
 * InfinitePay e Getnet coexistirem; forma sem adquirente usa o default do
 * ambiente (`PAYMENT_PORT`, mesmo padrão do EmissorPort fiscal #501).
 * Adicionar uma adquirente = novo adapter + linha no registry + valor no enum.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    MockPaymentAdapter,
    InfinitePayAdapter,
    GetnetAdapter,
    PaymentPortRegistry,
    PaymentAuthorizationService,
  ],
  exports: [PaymentAuthorizationService],
})
export class PaymentGatewayModule {}
