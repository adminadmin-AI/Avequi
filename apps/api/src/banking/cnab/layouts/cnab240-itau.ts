import { Cnab240Base, CnabBoleto, RetornoItem } from './cnab240-base';

// Itaú Unibanco — Código 341, ISPB 60701190
export class Cnab240Itau extends Cnab240Base {
  protected bankCode = '341';
  protected bankName = 'ITAU UNIBANCO S.A.';

  private readonly ISPB = '60701190';

  // ─── Occurrence codes for Itaú return files ──────────────────────────────

  private static readonly OCCURRENCES: Record<string, string> = {
    '02': 'Entrada Confirmada',
    '03': 'Entrada Rejeitada',
    '04': 'Transferência de Carteira / Entrada',
    '05': 'Transferência de Carteira / Baixa',
    '06': 'Liquidação Normal',
    '07': 'Liquidação Parcial — somente Itaú',
    '08': 'Liquidação em Cartório',
    '09': 'Baixado',
    '10': 'Baixa Solicitada',
    '11': 'Em Ser',
    '12': 'Abatimento Concedido',
    '13': 'Abatimento Cancelado',
    '14': 'Vencimento Alterado',
    '15': 'Desconto Alterado',
    '16': 'Alteração de Dados',
    '17': 'Liquidação após Baixa ou Protesto',
    '19': 'Confirmação Instrução de Protesto',
    '20': 'Confirmação de Sustação de Protesto',
    '23': 'Remessa a Cartório (Entrada)',
    '24': 'Retirada de Cartório (Baixa)',
    '25': 'Protestado e Baixado',
    '26': 'Instrução Rejeitada',
    '27': 'Confirmação Pedido Alteração de Outros Dados',
    '28': 'Débito de Tarifas / Custas',
    '29': 'Ocorrências do Sacado',
    '30': 'Alteração de Outros Dados Rejeitada',
  };

  // ─── Segment P — Payment data ─────────────────────────────────────────────

  generateSegmentoP(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string {
    const agency = this.onlyDigits(boleto.bankAccount.agency ?? '');
    const account = this.onlyDigits(boleto.bankAccount.accountNumber ?? '');

    let line = '';
    line += this.padLeft(this.bankCode, 3);            // 001-003  Banco
    line += this.padLeft(loteSeq, 4);                  // 004-007  Lote
    line += '3';                                        // 008      Tipo registro
    line += this.padLeft(itemSeq, 5);                  // 009-013  Nº sequencial
    line += 'P';                                        // 014      Segmento
    line += ' ';                                        // 015      Uso FEBRABAN
    line += '01';                                       // 016-017  Código movimento remessa
    line += this.padLeft(agency, 5);                   // 018-022  Agência
    line += ' ';                                        // 023      Dígito agência
    line += this.padLeft(account, 12);                 // 024-035  Conta
    line += ' ';                                        // 036      Dígito conta
    line += '0';                                        // 037      Dígito ag/conta
    line += this.padLeft(boleto.nossoNumero, 20);      // 038-057  Nosso número
    line += '109';                                      // 058-060  Carteira Itaú (109=cobrança registrada)
    line += '2';                                        // 061      Tipo de documento (2=DM)
    line += ' ';                                        // 062      Identificação distribuição
    line += this.padRight(boleto.seuNumero ?? '', 15); // 063-077  Número do documento
    line += this.formatDate(boleto.dueDate);           // 078-085  Data de vencimento
    line += this.formatDecimal(Number(boleto.amount), 15, 2); // 086-100  Valor nominal
    line += this.padLeft('0', 5);                      // 101-105  Banco cobrador
    line += '0';                                        // 106      Dígito ag. cobradora
    line += '01';                                       // 107-108  Espécie (01=DM)
    line += 'N';                                        // 109      Aceite
    line += this.formatDate(new Date());               // 110-117  Data emissão
    line += '00';                                       // 118-119  Instrução 1
    line += '00';                                       // 120-121  Instrução 2
    line += this.formatDecimal(0, 15, 2);              // 122-136  Juros por dia
    line += this.padLeft('0', 8);                      // 137-144  Data limite desconto
    line += this.formatDecimal(0, 15, 2);              // 145-159  Valor desconto
    line += this.formatDecimal(0, 15, 2);              // 160-174  Valor IOF
    line += this.formatDecimal(0, 15, 2);              // 175-189  Valor abatimento
    const docType = this.onlyDigits(boleto.payerDocument).length === 11 ? '01' : '02';
    line += docType;                                    // 190-191  Tipo inscrição sacado
    line += this.padLeft(this.onlyDigits(boleto.payerDocument), 15); // 192-206
    line += this.padRight('', 10);                     // 207-216  Uso banco
    line += '3';                                        // 217      Código protesto (3=não protestar)
    line += '00';                                       // 218-219  Prazo protesto
    line += '1';                                        // 220      Código baixa
    line += this.padLeft('60', 3);                     // 221-223  Prazo baixa
    line += this.padLeft('9', 4);                      // 224-227  Moeda (9=Real)
    line += this.padLeft('0', 10);                     // 228-237  Uso banco
    line += '   ';                                      // 238-240  Ocorrências

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
    line += '00';                                       // 140-141  Tipo sacador/avalista
    line += this.padLeft('0', 15);                     // 142-156  CNPJ sacador
    line += this.padRight('', 40);                     // 157-196  Nome sacador
    line += this.padLeft('0', 3);                      // 197-199  Banco correspondente
    line += this.padLeft('0', 20);                     // 200-219  Nosso número correspondente
    line += this.padRight('', 8);                      // 220-227  Uso banco
    line += '   ';                                      // 228-230  Ocorrências
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
    line += this.formatDecimal(2, 15, 2);              // 075-089  Valor/Percentual multa
    line += this.padRight(boleto.payerName, 25);       // 090-114  Informação sacado
    line += this.padRight(boleto.instructions ?? '', 40); // 115-154  Mensagem 3
    line += this.padRight('', 40);                     // 155-194  Mensagem 4
    line += this.padLeft('0', 8);                      // 195-202  Uso banco
    line += '0';                                        // 203      Código ocorrência sacado
    line += this.padLeft('0', 8);                      // 204-211  Data ocorrência
    line += this.padLeft('0', 15);                     // 212-226  Valor ocorrência
    line += this.padRight('', 9);                      // 227-235  Complemento
    line += this.padLeft('0', 3);                      // 236-238  Banco correspondente
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
    const occurrenceDesc = Cnab240Itau.OCCURRENCES[occurrence] ?? `Ocorrência ${occurrence}`;

    const amountRaw = line.substring(85, 100).trim();
    const amount = parseInt(amountRaw || '0', 10) / 100;

    const paidAmountRaw = line.substring(143, 158).trim();
    const paidAmount = parseInt(paidAmountRaw || '0', 10) / 100;

    let paidAt: Date | null = null;
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
