import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { Cnab240Base } from './layouts/cnab240-base';
import { Cnab240Inter } from './layouts/cnab240-inter';
import { Cnab240Sicoob } from './layouts/cnab240-sicoob';
import { Cnab240Bradesco } from './layouts/cnab240-bradesco';
import { Cnab240Itau } from './layouts/cnab240-itau';
import { Cnab240BB } from './layouts/cnab240-bb';
import { Cnab400Base } from './layouts/cnab400-base';
import { Cnab400Inter } from './layouts/cnab400-inter';
import { Cnab400Sicoob } from './layouts/cnab400-sicoob';

export type CnabFormat = 'CNAB240' | 'CNAB400';

const SUPPORTED_CNAB240 = '077 (Inter), 756 (Sicoob), 237 (Bradesco), 341 (Itaú), 001 (BB)';
const SUPPORTED_CNAB400 = '077 (Inter), 756 (Sicoob)';

export class CnabLayoutFactory {
  /**
   * Returns a CNAB 240 layout instance for the given bank code.
   * Alias for getLayout(bankCode, 'CNAB240').
   */
  static create(bankCode: string): Cnab240Base {
    return CnabLayoutFactory.getCnab240(bankCode);
  }

  /**
   * Returns a layout instance based on bankCode and format.
   * @param bankCode  3-digit bank code (e.g. '077', '237')
   * @param format    'CNAB240' (default) | 'CNAB400'
   */
  static getLayout(bankCode: string, format: CnabFormat = 'CNAB240'): Cnab240Base | Cnab400Base {
    if (format === 'CNAB400') {
      return CnabLayoutFactory.getCnab400(bankCode);
    }
    return CnabLayoutFactory.getCnab240(bankCode);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private static getCnab240(bankCode: string): Cnab240Base {
    switch (bankCode) {
      case '077':
        return new Cnab240Inter();
      case '756':
        return new Cnab240Sicoob();
      case '237':
        return new Cnab240Bradesco();
      case '341':
        return new Cnab240Itau();
      case '001':
        return new Cnab240BB();
      default:
        throw new BusinessException(
          `Banco '${bankCode}' não tem layout CNAB 240 implementado. Bancos suportados: ${SUPPORTED_CNAB240}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
    }
  }

  private static getCnab400(bankCode: string): Cnab400Base {
    switch (bankCode) {
      case '077':
        return new Cnab400Inter();
      case '756':
        return new Cnab400Sicoob();
      default:
        throw new BusinessException(
          `Banco '${bankCode}' não tem layout CNAB 400 implementado. Bancos suportados: ${SUPPORTED_CNAB400}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
    }
  }
}
