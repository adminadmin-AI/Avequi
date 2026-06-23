import { Boleto } from '../../../../generated/prisma';

export interface Cnab400Boleto extends Boleto {
  bankAccount: {
    id: string;
    name: string;
    bankCode: string | null;
    agency: string | null;
    accountNumber: string | null;
  };
}

export interface Cnab400RetornoItem {
  nossoNumero: string;
  occurrence: string;
  occurrenceDesc: string;
  amount: number;
  paidAmount: number;
  paidAt: Date | null;
}

export interface Cnab400CompanyInfo {
  cnpj: string;
  name: string;
}

/**
 * Abstract base for CNAB 400 format.
 * Lines are 400 characters.
 * Record types: 0=Header, 1=Detalhe, 7=Detalhe complementar, 9=Trailer
 */
export abstract class Cnab400Base {
  protected abstract bankCode: string;
  protected abstract bankName: string;

  // ─── String utilities ─────────────────────────────────────────────────────

  padRight(str: string, length: number, char = ' '): string {
    const s = (str ?? '').toString().substring(0, length);
    return s.padEnd(length, char);
  }

  padLeft(str: string | number, length: number, char = '0'): string {
    const s = (str ?? '').toString().substring(0, length);
    return s.padStart(length, char);
  }

  formatDate(date: Date): string {
    // DDMMAA (CNAB 400 uses 6-digit dates)
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}${mm}${yy}`;
  }

  formatDecimal(value: number, length: number, decimals: number): string {
    const factor = Math.pow(10, decimals);
    const intVal = Math.round(value * factor);
    return this.padLeft(intVal.toString(), length);
  }

  protected onlyDigits(str: string): string {
    return (str ?? '').replace(/\D/g, '');
  }

  protected currentDate(): string {
    return this.formatDate(new Date());
  }

  // ─── Abstract record generators ───────────────────────────────────────────

  abstract generateHeader(company: Cnab400CompanyInfo, sequenceNumber: number): string;
  abstract generateDetail(boleto: Cnab400Boleto, sequenceNumber: number): string;
  abstract generateTrailer(totalRecords: number, totalAmount: number): string;
  abstract parseRetornoLine(line: string): Cnab400RetornoItem | null;

  // ─── Full file generation ─────────────────────────────────────────────────

  generateRemessaFile(
    company: Cnab400CompanyInfo,
    boletos: Cnab400Boleto[],
    sequenceNumber: number,
  ): string {
    const lines: string[] = [];

    // Record 0: Header
    lines.push(this.generateHeader(company, sequenceNumber));

    // Record 1: Details
    boletos.forEach((boleto, idx) => {
      lines.push(this.generateDetail(boleto, idx + 1));
    });

    const totalAmount = boletos.reduce((sum, b) => sum + Number(b.amount), 0);

    // Record 9: Trailer
    // total = header + details + trailer
    lines.push(this.generateTrailer(lines.length + 1, totalAmount));

    return lines.join('\n');
  }
}
