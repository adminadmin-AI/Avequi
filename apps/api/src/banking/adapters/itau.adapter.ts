import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { BankAdapter, BoletoData, PixChargeData } from './bank-adapter.interface';

export interface ItauConfig {
  clientId: string;
  clientSecret: string;
  certificatePem?: string;
  sandbox?: boolean;
}

/**
 * Itaú Bank API adapter.
 * Implements OAuth2 client_credentials authentication.
 * Production: https://sts.itau.com.br/api/oauth/token
 * Pix: https://sandbox.devportal.itau.com.br/itau-ep9-gtw-pix-recebimentos-ext-v2/v2/cob
 */
export class ItauAdapter implements BankAdapter {
  readonly bankCode = '341';

  private accessToken: string | null = null;
  private tokenExpiresAt: Date | null = null;

  constructor(private readonly config: ItauConfig) {}

  async authenticate(): Promise<void> {
    // Production: POST https://sts.itau.com.br/api/oauth/token
    // with client_credentials + mTLS certificate
    throw new BusinessException(
      'Itaú API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async registerBoleto(
    _boleto: BoletoData,
  ): Promise<{ nossoNumero: string; barcode: string }> {
    throw new BusinessException(
      'Itaú API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async cancelBoleto(_nossoNumero: string): Promise<void> {
    throw new BusinessException(
      'Itaú API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async createPixCharge(
    _data: PixChargeData,
  ): Promise<{ txId: string; qrCode: string }> {
    throw new BusinessException(
      'Itaú API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  async getPixChargeStatus(
    _txId: string,
  ): Promise<{ status: string; paidAmount?: number }> {
    throw new BusinessException(
      'Itaú API not configured',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
