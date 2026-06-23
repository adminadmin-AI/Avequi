import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { BankAdapter, BoletoData, PixChargeData } from './bank-adapter.interface';

export interface BbConfig {
  clientId: string;
  clientSecret: string;
  certificatePem?: string;
  sandbox?: boolean;
}

/**
 * Banco do Brasil API adapter.
 * Implements OAuth2 client_credentials authentication.
 * Production: https://oauth.bb.com.br/oauth/token
 * Developer portal: https://developers.bb.com.br
 */
export class BbAdapter implements BankAdapter {
  readonly bankCode = '001';

  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(private readonly config: BbConfig) {}

  async authenticate(): Promise<void> {
    // Production: POST https://oauth.bb.com.br/oauth/token
    // with client_credentials grant + Basic auth (clientId:clientSecret)
    throw new BusinessException(
      'Banco do Brasil API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async registerBoleto(
    _boleto: BoletoData,
  ): Promise<{ nossoNumero: string; barcode: string }> {
    throw new BusinessException(
      'Banco do Brasil API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async cancelBoleto(_nossoNumero: string): Promise<void> {
    throw new BusinessException(
      'Banco do Brasil API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async createPixCharge(
    _data: PixChargeData,
  ): Promise<{ txId: string; qrCode: string }> {
    throw new BusinessException(
      'Banco do Brasil API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async getPixChargeStatus(
    _txId: string,
  ): Promise<{ status: string; paidAmount?: number }> {
    throw new BusinessException(
      'Banco do Brasil API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
