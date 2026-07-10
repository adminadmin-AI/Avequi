import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AuthorizeRequest, AuthorizeResult, PaymentPort, VoidRequest } from '../payment.port';

/**
 * Adapter Getnet (#596 multi-adquirente) — segunda adquirente da GDR. STUB no
 * mesmo padrão do InfinitePay: a integração real (API Getnet Digital — OAuth2
 * client_credentials + POST /v1/payments) entra aqui, guardada pelas
 * credenciais de ambiente. Sem credenciais, falha explícito em vez de
 * autorizar às cegas — produção nunca fatura sem passar de verdade.
 *
 * Env vars (Railway): GETNET_SELLER_ID, GETNET_CLIENT_ID, GETNET_CLIENT_SECRET
 * (+ GETNET_BASE_URL para alternar sandbox/produção).
 */
@Injectable()
export class GetnetAdapter implements PaymentPort {
  readonly name = 'getnet';
  private readonly logger = new Logger(GetnetAdapter.name);

  private get configured(): boolean {
    return !!(
      process.env.GETNET_SELLER_ID &&
      process.env.GETNET_CLIENT_ID &&
      process.env.GETNET_CLIENT_SECRET
    );
  }

  async authorize(_req: AuthorizeRequest): Promise<AuthorizeResult> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Getnet não configurada (GETNET_SELLER_ID/CLIENT_ID/CLIENT_SECRET ausentes). ' +
          'Configure as credenciais ou aponte a adquirente para outro gateway.',
      );
    }
    // TODO(#596): autorização real na API Getnet (token OAuth2 → POST /v1/payments/credit|debit).
    // Mapear resposta → { authorized, authCode, nsu, brand, providerRef: payment_id }.
    this.logger.error('GetnetAdapter.authorize não implementado — integração real pendente');
    throw new ServiceUnavailableException('Integração Getnet ainda não implementada');
  }

  async voidPayment(_req: VoidRequest): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException('Getnet não configurada');
    }
    // TODO(#596): estorno real na Getnet (POST /v1/payments/{payment_id}/cancel).
    throw new ServiceUnavailableException('Estorno Getnet ainda não implementado');
  }
}
