import { Cnab400Base, Cnab400Boleto, Cnab400CompanyInfo, Cnab400RetornoItem } from './cnab400-base';

// Sicoob — CNAB 400 — Código 756
// Legacy format still used by some cooperative clients
export class Cnab400Sicoob extends Cnab400Base {
  protected bankCode = '756';
  protected bankName = 'BANCOOB/SICOOB';

  // ─── Occurrence codes for Sicoob CNAB 400 return files ───────────────────

  private static readonly OCCURRENCES: Record<string, string> = {
    '02': 'Entrada Confirmada',
    '03': 'Entrada Rejeitada',
    '04': 'Transferência de Carteira / Entrada',
    '05': 'Transferência de Carteira / Baixa',
    '06': 'Liquidação Normal',
    '07': 'Liquidação Parcial',
    '08': 'Liquidação em Cartório',
    '09': 'Baixa Automática',
    '10': 'Baixa Solicitada',
    '11': 'Arquivo em Ser',
    '12': 'Abatimento Concedido',
    '13': 'Abatimento Cancelado',
    '14': 'Vencimento Alterado',
    '15': 'Desconto Alterado',
    '16': 'Alteração de Dados',
    '17': 'Liquidação após Baixa',
    '19': 'Confirmação Instrução Protesto',
    '20': 'Confirmação Instrução Sustar Protesto',
    '23': 'Remessa a Cartório',
    '24': 'Retirada de Cartório',
    '25': 'Protestado e Baixado',
    '27': 'Alteração de Outros Dados',
    '28': 'Débito de Tarifas',
    '30': 'Alteração de Dados Rejeitada',
  };

  // ─── Header (registro tipo 0) ─────────────────────────────────────────────

  generateHeader(company: Cnab400CompanyInfo, sequenceNumber: number): string {
    let line = '';
    line += '0';                                              // 001      Tipo de registro
    line += '1';                                              // 002      Operação (1=remessa)
    line += 'REMESSA';                                        // 003-009  Literal
    line += '01';                                             // 010-011  Código serviço (01=cobrança)
    line += this.padRight('COBRANCA', 15);                   // 012-026  Literal serviço
    line += this.padLeft(this.onlyDigits(company.cnpj), 20); // 027-046  CNPJ/convênio empresa
    line += this.padRight(company.name, 30);                  // 047-076  Nome empresa
    line += this.padLeft(this.bankCode, 3);                  // 077-079  Código banco
    line += this.padRight(this.bankName, 15);                // 080-094  Nome banco
    line += this.currentDate();                               // 095-100  Data geração DDMMAA
    line += this.padRight('', 8);                            // 101-108  Branco
    line += this.padLeft(sequenceNumber, 7);                 // 109-115  Sequencial remessa
    line += this.padRight('', 284);                          // 116-399  Complemento
    line += this.padLeft('1', 6);                            // posição final → sequencial registro

    return line.padEnd(400, ' ').substring(0, 400);
  }

  // ─── Detail (registro tipo 1) ─────────────────────────────────────────────

  generateDetail(boleto: Cnab400Boleto, sequenceNumber: number): string {
    const agency = this.onlyDigits(boleto.bankAccount.agency ?? '');
    const account = this.onlyDigits(boleto.bankAccount.accountNumber ?? '');
    const docType = this.onlyDigits(boleto.payerDocument).length === 11 ? '01' : '02';

    let line = '';
    line += '1';                                              // 001      Tipo de registro
    line += docType;                                          // 002-003  Tipo inscrição empresa
    line += this.padLeft(this.onlyDigits(boleto.bankAccount.accountNumber ?? ''), 14); // 004-017
    line += this.padLeft(agency, 5);                         // 018-022  Agência
    line += ' ';                                              // 023      Dígito agência
    line += this.padLeft(account, 10);                       // 024-033  Conta
    line += '0';                                              // 034      Dígito conta
    line += this.padRight('', 4);                            // 035-038  Uso banco
    line += this.padLeft(boleto.nossoNumero, 11);            // 039-049  Nosso número
    line += this.padRight('', 20);                           // 050-069  Uso banco
    line += '3';                                              // 070      Carteira (3=cobrança simples)
    line += '01';                                             // 071-072  Código ocorrência
    line += this.padRight(boleto.seuNumero ?? '', 10);       // 073-082  Seu número
    line += this.formatDate(boleto.dueDate);                 // 083-088  Vencimento
    line += this.formatDecimal(Number(boleto.amount), 13, 2); // 089-101  Valor
    line += this.padLeft(this.bankCode, 3);                  // 102-104  Banco cobrador
    line += this.padLeft('0', 5);                            // 105-109  Agência cobradora
    line += '02';                                             // 110-111  Espécie (02=DM)
    line += 'N';                                              // 112      Aceite
    line += this.formatDate(new Date());                     // 113-118  Data emissão
    line += '00';                                             // 119-120  Instrução 1 (00=sem)
    line += '00';                                             // 121-122  Instrução 2 (00=sem)
    line += this.formatDecimal(0, 13, 2);                    // 123-135  Juros mora
    line += this.formatDecimal(0, 6, 0);                     // 136-141  Data limite desconto
    line += this.formatDecimal(0, 13, 2);                    // 142-154  Valor desconto
    line += this.formatDecimal(0, 13, 2);                    // 155-167  Valor IOF
    line += this.formatDecimal(0, 13, 2);                    // 168-180  Abatimento
    line += docType;                                          // 181-182  Tipo inscrição sacado
    line += this.padLeft(this.onlyDigits(boleto.payerDocument), 14); // 183-196
    line += this.padRight(boleto.payerName, 30);             // 197-226  Nome sacado
    line += this.padRight(boleto.payerAddress ?? '', 40);    // 227-266  Endereço
    line += this.padRight(boleto.payerCity ?? '', 15);       // 267-281  Cidade
    line += this.padLeft(this.onlyDigits(boleto.payerZipCode ?? '00000000'), 8); // 282-289
    line += this.padRight(boleto.payerState ?? '', 2);       // 290-291  UF
    line += this.padRight(boleto.instructions ?? '', 40);    // 292-331  Instruções
    line += this.padRight('', 60);                           // 332-391  Complemento
    line += this.padLeft(sequenceNumber, 6);                 // sequencial registro

    return line.padEnd(400, ' ').substring(0, 400);
  }

  // ─── Trailer (registro tipo 9) ────────────────────────────────────────────

  generateTrailer(totalRecords: number, totalAmount: number): string {
    let line = '';
    line += '9';                                              // 001      Tipo de registro
    line += this.padRight('', 393);                          // 002-394  Uso banco
    line += this.padLeft(totalRecords, 6);                   // 395-400  Total registros

    return line.padEnd(400, ' ').substring(0, 400);
  }

  // ─── Retorno parser ───────────────────────────────────────────────────────

  parseRetornoLine(line: string): Cnab400RetornoItem | null {
    if (!line || line.length < 400) return null;

    const tipoRegistro = line[0];
    if (tipoRegistro !== '1') return null;

    const nossoNumero = line.substring(38, 49).trim();

    // Occurrence code at positions 108-109
    const occurrence = line.substring(108, 110).trim();
    const occurrenceDesc = Cnab400Sicoob.OCCURRENCES[occurrence] ?? `Ocorrência ${occurrence}`;

    // Amount at positions 152-164
    const amountRaw = line.substring(152, 165).trim();
    const amount = parseInt(amountRaw || '0', 10) / 100;

    // Paid amount at positions 165-177
    const paidAmountRaw = line.substring(165, 178).trim();
    const paidAmount = parseInt(paidAmountRaw || '0', 10) / 100;

    // Paid date (DDMMAA) at positions 110-115
    let paidAt: Date | null = null;
    const paidDateRaw = line.substring(110, 116).trim();
    if (paidDateRaw && paidDateRaw !== '000000') {
      const day = parseInt(paidDateRaw.substring(0, 2), 10);
      const month = parseInt(paidDateRaw.substring(2, 4), 10) - 1;
      const year = 2000 + parseInt(paidDateRaw.substring(4, 6), 10);
      if (day > 0 && month >= 0 && year > 2000) {
        paidAt = new Date(year, month, day);
      }
    }

    return {
      nossoNumero,
      occurrence,
      occurrenceDesc,
      amount,
      paidAmount,
      paidAt,
    };
  }
}
