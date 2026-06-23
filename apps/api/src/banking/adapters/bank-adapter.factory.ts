import { BankAdapter } from './bank-adapter.interface';
import { BradescoAdapter, BradescoConfig } from './bradesco.adapter';
import { ItauAdapter, ItauConfig } from './itau.adapter';
import { BbAdapter, BbConfig } from './bb.adapter';

export interface BankAdapterConfig {
  clientId: string;
  clientSecret: string;
  certificatePem?: string;
  sandbox?: boolean;
}

/**
 * Factory for bank API adapters.
 * Use bankCode (FEBRABAN) to retrieve the correct adapter instance.
 */
export function getBankAdapter(
  bankCode: string,
  config: BankAdapterConfig,
): BankAdapter {
  switch (bankCode) {
    case '001':
      return new BbAdapter(config as BbConfig);
    case '237':
      return new BradescoAdapter(config as BradescoConfig);
    case '341':
      return new ItauAdapter(config as ItauConfig);
    default:
      throw new Error(
        `Banco ${bankCode} não possui adapter implementado. Bancos suportados: 001 (BB), 237 (Bradesco), 341 (Itaú)`,
      );
  }
}
