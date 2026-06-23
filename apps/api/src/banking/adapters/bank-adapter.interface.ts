export interface BoletoData {
  nossoNumero?: string;
  amount: number;
  dueDate: Date;
  payerName: string;
  payerDocument: string;
  description?: string;
}

export interface PixChargeData {
  pixKey: string;
  amount: number;
  description?: string;
  txId: string;
  expiresAt?: Date;
}

export interface BankAdapter {
  bankCode: string;

  /**
   * Authenticate with the bank API (OAuth2, certificate, etc.)
   */
  authenticate(): Promise<void>;

  /**
   * Register a boleto with the bank API.
   * Returns nossoNumero and barcode assigned by the bank.
   */
  registerBoleto(boleto: BoletoData): Promise<{ nossoNumero: string; barcode: string }>;

  /**
   * Cancel (baixar) a boleto at the bank.
   */
  cancelBoleto(nossoNumero: string): Promise<void>;

  /**
   * Create a Pix charge (dynamic QR code) via the bank API.
   * Returns the txId and qrCode EMV payload from the bank.
   */
  createPixCharge(data: PixChargeData): Promise<{ txId: string; qrCode: string }>;

  /**
   * Query the status of a Pix charge.
   */
  getPixChargeStatus(txId: string): Promise<{ status: string; paidAmount?: number }>;
}
