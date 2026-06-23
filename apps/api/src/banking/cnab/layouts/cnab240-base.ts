import { Boleto } from '../../../../generated/prisma';

export interface CnabBoleto extends Boleto {
  bankAccount: {
    id: string;
    name: string;
    bankCode: string | null;
    agency: string | null;
    accountNumber: string | null;
  };
}

export interface RetornoItem {
  nossoNumero: string;
  occurrence: string;
  occurrenceDesc: string;
  amount: number;
  paidAmount: number;
  paidAt: Date | null;
}

export interface CompanyInfo {
  cnpj: string;
  name: string;
}

export abstract class Cnab240Base {
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
    // DDMMAAAA
    const d = new Date(date);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}${mm}${yyyy}`;
  }

  formatDecimal(value: number, length: number, decimals: number): string {
    // Returns zero-padded integer representation (e.g., 1500.75 with length=13, decimals=2 → 0000000150075)
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

  protected currentTime(): string {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${hh}${mm}${ss}`;
  }

  // ─── Abstract segment generators ──────────────────────────────────────────

  abstract generateSegmentoP(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string;
  abstract generateSegmentoQ(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string;
  abstract generateSegmentoR(boleto: CnabBoleto, loteSeq: number, itemSeq: number): string;
  abstract parseRetornoLine(line: string): RetornoItem | null;

  // ─── Header / Trailer Arquivo ─────────────────────────────────────────────

  generateHeaderArquivo(company: CompanyInfo, sequenceNumber: number): string {
    let line = '';
    line += this.padLeft(this.bankCode, 3);              // 001-003  Código do banco
    line += '0000';                                       // 004-007  Lote (header = 0000)
    line += '0';                                          // 008      Tipo de registro (0=header)
    line += this.padRight('', 9);                         // 009-017  Uso exclusivo FEBRABAN
    line += '2';                                          // 018      Tipo de inscrição (2=CNPJ)
    line += this.padLeft(this.onlyDigits(company.cnpj), 14); // 019-032
    line += this.padRight('', 20);                        // 033-052  Convênio (banco define)
    line += this.padRight('', 5);                         // 053-057  Agência
    line += ' ';                                          // 058
    line += this.padRight('', 12);                        // 059-070  Nº da conta
    line += ' ';                                          // 071
    line += ' ';                                          // 072      Dígito conta
    line += this.padRight(company.name, 30);              // 073-102  Nome da empresa
    line += this.padRight(this.bankName, 30);             // 103-132  Nome do banco
    line += this.padRight('', 10);                        // 133-142  Uso FEBRABAN
    line += '1';                                          // 143      Código do arquivo (1=remessa)
    line += this.currentDate();                           // 144-151  Data de geração (DDMMAAAA)
    line += this.currentTime();                           // 152-157  Hora de geração (HHMMSS)
    line += this.padLeft(sequenceNumber, 6);              // 158-163  Número sequencial
    line += this.padLeft('103', 3);                       // 164-166  Versão layout (103)
    line += '01600';                                      // 167-171  Densidade da gravação
    line += this.padRight('', 20);                        // 172-191  Uso banco
    line += this.padRight('', 20);                        // 192-211  Uso empresa
    line += this.padRight('', 29);                        // 212-240  Uso FEBRABAN
    return line.padEnd(240, ' ').substring(0, 240);
  }

  generateTrailerArquivo(totalLotes: number, totalLinhas: number): string {
    let line = '';
    line += this.padLeft(this.bankCode, 3);   // 001-003
    line += '9999';                            // 004-007  Lote (trailer = 9999)
    line += '9';                               // 008      Tipo registro (9=trailer)
    line += this.padRight('', 9);             // 009-017  Uso FEBRABAN
    line += this.padLeft(totalLotes, 6);      // 018-023  Qtd de lotes
    line += this.padLeft(totalLinhas, 6);     // 024-029  Qtd de registros
    line += this.padLeft('0', 6);             // 030-035  Qtd contas conciliação
    line += this.padRight('', 205);           // 036-240  Uso FEBRABAN
    return line.padEnd(240, ' ').substring(0, 240);
  }

  // ─── Header / Trailer Lote ────────────────────────────────────────────────

  generateHeaderLote(
    company: CompanyInfo,
    loteSeq: number,
    totalItems: number,
  ): string {
    let line = '';
    line += this.padLeft(this.bankCode, 3);              // 001-003
    line += this.padLeft(loteSeq, 4);                    // 004-007  Nº do lote
    line += '1';                                          // 008      Tipo de registro (1=header lote)
    line += 'C';                                          // 009      Operação (C=crédito/cobrança)
    line += '03';                                         // 010-011  Tipo de serviço (03=cobrança)
    line += '00';                                         // 012-013  Forma lançamento
    line += '040';                                        // 014-016  Versão layout lote
    line += ' ';                                          // 017      Uso FEBRABAN
    line += '2';                                          // 018      Tipo inscrição (2=CNPJ)
    line += this.padLeft(this.onlyDigits(company.cnpj), 14); // 019-032
    line += this.padRight('', 20);                        // 033-052  Convênio
    line += this.padRight('', 5);                         // 053-057  Agência
    line += ' ';                                          // 058
    line += this.padRight('', 12);                        // 059-070  Conta
    line += ' ';                                          // 071
    line += ' ';                                          // 072
    line += this.padRight(company.name, 30);              // 073-102  Nome empresa
    line += this.padRight('', 40);                        // 103-142  Mensagem 1
    line += this.padRight('', 40);                        // 143-182  Mensagem 2
    line += this.padLeft('1', 6);                         // 183-188  Nº remessa/retorno
    line += this.currentDate();                           // 189-196  Data gravação
    line += this.padRight('', 8);                         // 197-204  Data crédito
    line += this.padRight('', 33);                        // 205-237  Uso FEBRABAN
    line += '   ';                                        // 238-240  Ocorrências
    return line.padEnd(240, ' ').substring(0, 240);
  }

  generateTrailerLote(
    loteSeq: number,
    totalRegistros: number,
    totalAmount: number,
  ): string {
    let line = '';
    line += this.padLeft(this.bankCode, 3);              // 001-003
    line += this.padLeft(loteSeq, 4);                    // 004-007
    line += '5';                                          // 008      Tipo registro (5=trailer lote)
    line += this.padRight('', 9);                         // 009-017  Uso FEBRABAN
    line += this.padLeft(totalRegistros, 6);              // 018-023  Qtd registros no lote
    line += this.formatDecimal(totalAmount, 18, 2);       // 024-041  Valor total
    line += this.padLeft('0', 18);                        // 042-059  Qtd títulos em carteira
    line += this.padLeft('0', 18);                        // 060-077  Valor total em carteira
    line += this.padRight('', 8);                         // 078-085  Nº aviso débito
    line += this.padRight('', 151);                       // 086-236  Uso FEBRABAN
    line += '   ';                                        // 237-239  Ocorrências
    return line.padEnd(240, ' ').substring(0, 240);
  }

  // ─── Full file generation ─────────────────────────────────────────────────

  generateRemessaFile(
    company: CompanyInfo,
    bankAccount: CnabBoleto['bankAccount'],
    boletos: CnabBoleto[],
    sequenceNumber: number,
  ): string {
    const lines: string[] = [];
    const loteSeq = 1;

    // Header arquivo
    lines.push(this.generateHeaderArquivo(company, sequenceNumber));

    // Header lote
    lines.push(this.generateHeaderLote(company, loteSeq, boletos.length));

    // Segments per boleto
    let segLineCount = 0;
    boletos.forEach((boleto, idx) => {
      const itemSeq = idx + 1;
      lines.push(this.generateSegmentoP(boleto, loteSeq, itemSeq));
      lines.push(this.generateSegmentoQ(boleto, loteSeq, itemSeq));
      lines.push(this.generateSegmentoR(boleto, loteSeq, itemSeq));
      segLineCount += 3;
    });

    const totalLoteRegistros = 2 + segLineCount; // header lote + trailer lote + segments
    const totalAmount = boletos.reduce((sum, b) => sum + Number(b.amount), 0);

    // Trailer lote
    lines.push(this.generateTrailerLote(loteSeq, totalLoteRegistros + 2, totalAmount));

    // Trailer arquivo: 1 header + 1 header lote + segments + 1 trailer lote + 1 trailer = total
    const totalLines = lines.length + 1;
    lines.push(this.generateTrailerArquivo(1, totalLines));

    return lines.join('\n');
  }
}
