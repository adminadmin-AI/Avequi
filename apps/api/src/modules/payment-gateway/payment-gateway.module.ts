import { Module, Logger } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PAYMENT_PORT } from './payment.port';
import { MockPaymentAdapter } from './adapters/mock.adapter';
import { InfinitePayAdapter } from './adapters/infinitepay.adapter';
import { PaymentAuthorizationService } from './payment-authorization.service';

/**
 * Gateway de pagamento (#596). O adapter ativo é escolhido por `PAYMENT_PORT`
 * (mock | infinitepay), no mesmo padrão do EmissorPort fiscal (#501). Adicionar
 * uma nova adquirente = novo adapter + um case aqui.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    MockPaymentAdapter,
    InfinitePayAdapter,
    {
      provide: PAYMENT_PORT,
      inject: [MockPaymentAdapter, InfinitePayAdapter],
      useFactory: (mock: MockPaymentAdapter, infinitepay: InfinitePayAdapter) => {
        const selected = (process.env.PAYMENT_PORT ?? 'mock').toLowerCase();
        const port = { mock, infinitepay }[selected] ?? mock;
        new Logger('PaymentGateway').log(`Adapter de pagamento ativo: ${port.name}`);
        return port;
      },
    },
    PaymentAuthorizationService,
  ],
  exports: [PaymentAuthorizationService],
})
export class PaymentGatewayModule {}
