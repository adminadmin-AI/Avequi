import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuthorizeRequest, AuthorizeResult, PaymentPort, VoidRequest } from '../payment.port';

/**
 * Adapter InfinitePay (#596) — adquirente atual da GDR. STUB: a integração real
 * (REST/TEF InfinitePay) entra aqui, guardada pelas credenciais de ambiente.
 * Enquanto `INFINITEPAY_API_KEY` não estiver configurada, falha explícito em vez
 * de autorizar às cegas — assim produção nunca fatura sem passar de verdade.
 */
@Injectable()
export class InfinitePayAdapter implements PaymentPort {
  readonly name = 'infinitepay';
  private readonly logger = new Logger(InfinitePayAdapter.name);

  private get apiKey(): string | undefined {
    return process.env.INFINITEPAY_API_KEY;
  }

  async authorize(req: AuthorizeRequest): Promise<AuthorizeResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'InfinitePay não configurada (INFINITEPAY_API_KEY ausente). Configure as credenciais ou use PAYMENT_PORT=mock.',
      );
    }
    // TODO(#596): chamada real à API InfinitePay (autorização TEF/online).
    // Mapear resposta → { authorized, authCode, nsu, brand, providerRef }.
    this.logger.error('InfinitePayAdapter.authorize não implementado — integração real pendente');
    throw new ServiceUnavailableException('Integração InfinitePay ainda não implementada');
  }

  async voidPayment(_req: VoidRequest): Promise<void> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('InfinitePay não configurada');
    }
    // TODO(#596): estorno real na InfinitePay.
    throw new ServiceUnavailableException('Estorno InfinitePay ainda não implementado');
  }
}
