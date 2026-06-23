import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { BankAdapter, BoletoData, PixChargeData } from './bank-adapter.interface';

export interface BradescoConfig {
  clientId: string;
  clientSecret: string;
  certificatePem?: string;
  sandbox?: boolean;
}

/**
 * Bradesco Bank API adapter.
 * Implements OAuth2 client_credentials authentication.
 * Production endpoints require mTLS certificate + client credentials.
 */
export class BradescoAdapter implements BankAdapter {
  readonly bankCode = '237';

  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(private readonly config: BradescoConfig) {}

  async authenticate(): Promise<void> {
    // Production: POST https://proxy.api.prebanco.com.br/auth/server/unified/token
    // with client_credentials grant + mTLS certificate
    throw new BusinessException(
      'Bradesco API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async registerBoleto(
    _boleto: BoletoData,
  ): Promise<{ nossoNumero: string; barcode: string }> {
    throw new BusinessException(
      'Bradesco API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async cancelBoleto(_nossoNumero: string): Promise<void> {
    throw new BusinessException(
      'Bradesco API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async createPixCharge(
    _data: PixChargeData,
  ): Promise<{ txId: string; qrCode: string }> {
    throw new BusinessException(
      'Bradesco API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async getPixChargeStatus(
    _txId: string,
  ): Promise<{ status: string; paidAmount?: number }> {
    throw new BusinessException(
      'Bradesco API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
