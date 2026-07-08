import { Injectable, Logger } from '@nestjs/common';
import { AuthorizeRequest, AuthorizeResult, PaymentPort, VoidRequest } from '../payment.port';

/**
 * Adapter de TEF simulado (#596) — dev/homologação/testes. Autoriza tudo, exceto
 * quando o valor termina em `.13` (gatilho determinístico p/ testar negativa) ou
 * é ≤ 0. Gera authCode/NSU falsos com o shape da SEFAZ (grupo card).
 */
@Injectable()
export class MockPaymentAdapter implements PaymentPort {
  readonly name = 'mock';
  private readonly logger = new Logger(MockPaymentAdapter.name);

  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    const cents = Math.round(req.amount * 100) % 100;
    if (req.amount <= 0) {
      return { authorized: false, declineReason: 'Valor inválido' };
    }
    if (cents === 13) {
      this.logger.warn(`MOCK: negando autorização de R$ ${req.amount} (gatilho .13)`);
      return { authorized: false, declineReason: 'Transação negada pelo emissor (mock)' };
    }
    const providerRef = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    return {
      authorized: true,
      authCode: String(Math.floor(100000 + Math.random() * 900000)), // 6 dígitos
      nsu: String(Math.floor(100000000 + Math.random() * 900000000)),
      brand: req.brand,
      providerRef,
    };
  }

  async voidPayment(req: VoidRequest): Promise<void> {
    this.logger.log(`MOCK: estorno de ${req.paymentRef} (ref=${req.providerRef ?? '—'})`);
  }
}
