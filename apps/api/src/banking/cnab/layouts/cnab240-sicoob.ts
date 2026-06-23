import { Cnab240Base, CnabBoleto, RetornoItem } from './cnab240-base';

// Sicoob — Código 756
export class Cnab240Sicoob extends Cnab240Base {
  protected bankCode = '756';
  protected bankName = 'BANCOOB/SICOOB';

  // ─── Occurrence codes for Sicoob return files ─────────────────────────────

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

  // ─── Segment P — Payment data ─────────────────────────────────────────────

  generateSegmentoP(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string {
    const agency = this.onlyDigits(boleto.bankAccount.agency ?? '');
    const account = this.onlyDigits(boleto.bankAccount.accountNumber ?? '');

    let line = '';
    line += this.padLeft(this.bankCode, 3);            // 001-003
    line += this.padLeft(loteSeq, 4);                  // 004-007
    line += '3';                                        // 008
    line += this.padLeft(itemSeq, 5);                  // 009-013
    line += 'P';                                        // 014
    line += ' ';                                        // 015
    line += '01';                                       // 016-017  Código movimento (01=remessa)
    line += this.padLeft(agency, 5);                   // 018-022  Agência
    line += ' ';                                        // 023
    line += this.padLeft(account, 12);                 // 024-035  Conta
    line += ' ';                                        // 036
    line += '0';                                        // 037      Dígito verificador
    line += this.padLeft(boleto.nossoNumero, 20);      // 038-057  Nosso número
    line += '3';                                        // 058      Carteira (3=cobrança simples)
    line += '1';                                        // 059      Forma de cadastro
    line += ' ';                                        // 060      Tipo de documento
    line += 'N';                                        // 061      Identificação emissão bloqueto
    line += ' ';                                        // 062      Identificação distribuição
    line += this.padRight(boleto.seuNumero ?? '', 15); // 063-077  Nº do documento
    line += this.formatDate(boleto.dueDate);           // 078-085  Vencimento
    line += this.formatDecimal(Number(boleto.amount), 15, 2); // 086-100  Valor
    line += this.padLeft('0', 5);                      // 101-105  Banco cobrador
    line += '0';                                        // 106
    line += '02';                                       // 107-108  Espécie (02=DM)
    line += 'N';                                        // 109      Aceite
    line += this.formatDate(new Date());               // 110-117  Data emissão
    line += '00';                                       // 118-119  Instrução 1 (00=sem)
    line += '00';                                       // 120-121  Instrução 2
    line += this.formatDecimal(0, 15, 2);              // 122-136  Juros por dia
    line += this.padLeft('0', 8);                      // 137-144  Data limite desconto
    line += this.formatDecimal(0, 15, 2);              // 145-159  Valor desconto
    line += this.formatDecimal(0, 15, 2);              // 160-174  IOF
    line += this.formatDecimal(0, 15, 2);              // 175-189  Abatimento
    // Tipo inscrição: 01=CPF, 02=CNPJ
    const docType = this.onlyDigits(boleto.payerDocument).length === 11 ? '01' : '02';
    line += docType;                                    // 190-191
    line += this.padLeft(this.onlyDigits(boleto.payerDocument), 15); // 192-206
    line += this.padRight('', 10);                     // 207-216  Uso banco
    line += '0';                                        // 217      Código protesto
    line += '00';                                       // 218-219  Prazo protesto
    line += '1';                                        // 220      Código baixa
    line += this.padLeft('60', 3);                     // 221-223  Prazo baixa
    line += this.padLeft('9', 4);                      // 224-227  Moeda (9=Real)
    line += this.padLeft('0', 10);                     // 228-237  Uso banco
    line += '    ';                                     // 238-240  Ocorrências (Sicoob usa 3)

    return line.padEnd(240, ' ').substring(0, 240);
  }

  // ─── Segment Q — Payer data ───────────────────────────────────────────────

  generateSegmentoQ(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string {
    const docType = this.onlyDigits(boleto.payerDocument).length === 11 ? '01' : '02';

    let line = '';
    line += this.padLeft(this.bankCode, 3);            // 001-003
    line += this.padLeft(loteSeq, 4);                  // 004-007
    line += '3';                                        // 008
    line += this.padLeft(itemSeq, 5);                  // 009-013
    line += 'Q';                                        // 014
    line += ' ';                                        // 015
    line += '01';                                       // 016-017
    line += docType;                                    // 018-019
    line += this.padLeft(this.onlyDigits(boleto.payerDocument), 15); // 020-034
    line += this.padRight(boleto.payerName, 40);       // 035-074
    line += this.padRight(boleto.payerAddress ?? '', 40); // 075-114
    line += this.padRight(boleto.payerCity ?? '', 15); // 115-129
    line += this.padLeft(this.onlyDigits(boleto.payerZipCode ?? '00000000'), 8); // 130-137
    line += this.padRight(boleto.payerState ?? '', 2); // 138-139
    line += '00';                                       // 140-141  Tipo inscrição sacador/avalista
    line += this.padLeft('0', 15);                     // 142-156  CNPJ sacador/avalista
    line += this.padRight('', 40);                     // 157-196  Nome sacador/avalista
    line += this.padLeft('0', 3);                      // 197-199  Banco correspondente
    line += this.padLeft('0', 20);                     // 200-219  Nosso número banco correspondente
    line += this.padRight('', 8);                      // 220-227
    line += '   ';                                      // 228-230  Ocorrências (3 chars no Sicoob)
    line += this.padRight('', 10);                     // 231-240

    return line.padEnd(240, ' ').substring(0, 240);
  }

  // ─── Segment R — Discounts / fines ───────────────────────────────────────

  generateSegmentoR(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string {
    let line = '';
    line += this.padLeft(this.bankCode, 3);            // 001-003
    line += this.padLeft(loteSeq, 4);                  // 004-007
    line += '3';                                        // 008
    line += this.padLeft(itemSeq, 5);                  // 009-013
    line += 'R';                                        // 014
    line += ' ';                                        // 015
    line += '01';                                       // 016-017
    line += '0';                                        // 018      Desconto 2 - código
    line += this.padLeft('0', 8);                      // 019-026  Data desconto 2
    line += this.formatDecimal(0, 15, 2);              // 027-041  Valor desconto 2
    line += '0';                                        // 042      Desconto 3
    line += this.padLeft('0', 8);                      // 043-050  Data desconto 3
    line += this.formatDecimal(0, 15, 2);              // 051-065  Valor desconto 3
    line += '2';                                        // 066      Multa - código (2=percentual)
    line += this.padLeft('0', 8);                      // 067-074  Data multa
    line += this.formatDecimal(2, 15, 2);              // 075-089  Valor/Percentual multa (2%)
    line += this.padRight(boleto.payerName, 25);       // 090-114  Informação sacado
    line += this.padRight(boleto.instructions ?? '', 40); // 115-154  Mensagem 3
    line += this.padRight('', 40);                     // 155-194  Mensagem 4
    line += this.padLeft('0', 8);                      // 195-202
    line += '0';                                        // 203
    line += this.padLeft('0', 8);                      // 204-211
    line += this.padLeft('0', 15);                     // 212-226
    line += this.padRight('', 9);                      // 227-235
    line += this.padLeft('0', 3);                      // 236-238
    line += '  ';                                       // 239-240

    return line.padEnd(240, ' ').substring(0, 240);
  }

  // ─── Retorno parser ───────────────────────────────────────────────────────

  parseRetornoLine(line: string): RetornoItem | null {
    if (!line || line.length < 240) return null;

    const bankCode = line.substring(0, 3);
    if (bankCode !== this.bankCode) return null;

    const tipoRegistro = line[7];
    const segmento = line[13];

    if (tipoRegistro !== '3' || segmento !== 'P') return null;

    const nossoNumero = line.substring(37, 57).trim();
    const occurrence = line.substring(15, 17).trim();
    const occurrenceDesc = Cnab240Sicoob.OCCURRENCES[occurrence] ?? `Ocorrência ${occurrence}`;

    const amountRaw = line.substring(85, 100).trim();
    const amount = parseInt(amountRaw || '0', 10) / 100;

    // Sicoob: paid amount at positions 143-157
    const paidAmountRaw = line.substring(143, 158).trim();
    const paidAmount = parseInt(paidAmountRaw || '0', 10) / 100;

    let paidAt: Date | null = null;
    // Sicoob: paid date (DDMMAAAA) at positions 137-144
    const paidDateRaw = line.substring(137, 145).trim();
    if (paidDateRaw && paidDateRaw !== '00000000') {
      const day = parseInt(paidDateRaw.substring(0, 2), 10);
      const month = parseInt(paidDateRaw.substring(2, 4), 10) - 1;
      const year = parseInt(paidDateRaw.substring(4, 8), 10);
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
