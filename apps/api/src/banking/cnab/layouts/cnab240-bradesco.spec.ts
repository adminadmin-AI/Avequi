import { Cnab240Bradesco } from './cnab240-bradesco';
import { CnabBoleto } from './cnab240-base';

const mockBankAccount = {
  id: 'account-bradesco',
  name: 'Conta Bradesco',
  bankCode: '237',
  agency: '1234',
  accountNumber: '56789-0',
};

const mockBoleto: CnabBoleto = {
  id: 'boleto-bradesco-1',
  companyId: 'company-1',
  bankAccountId: 'account-bradesco',
  receivableId: null,
  nossoNumero: '00000000000010',
  seuNumero: 'BRA001',
  amount: 3200.00 as any,
  dueDate: new Date(2026, 8, 30), // Sep 30 2026 local time
  status: 'PENDING' as any,
  payerName: 'Empresa Teste Ltda',
  payerDocument: '11222333000181', // CNPJ
  payerAddress: 'Rua Augusta, 200',
  payerCity: 'São Paulo',
  payerState: 'SP',
  payerZipCode: '01305000',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Não aceitar após 5 dias do vencimento.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '12.345.678/0001-00',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab240Bradesco', () => {
  let layout: Cnab240Bradesco;

  beforeEach(() => {
    layout = new Cnab240Bradesco();
  });

  // ─── Utility methods ───────────────────────────────────────────────────────

  describe('padRight', () => {
    it('should pad string with spaces', () => {
      expect(layout.padRight('BRAD', 8)).toBe('BRAD    ');
    });
  });

  describe('padLeft', () => {
    it('should pad with zeros by default', () => {
      expect(layout.padLeft('7', 4)).toBe('0007');
    });
  });

  describe('formatDate', () => {
    it('should format date as DDMMAAAA', () => {
      const date = new Date(2026, 8, 30); // Sep 30 2026
      expect(layout.formatDate(date)).toBe('30092026');
    });
  });

  describe('formatDecimal', () => {
    it('should format 3200.00 correctly', () => {
      expect(layout.formatDecimal(3200.00, 15, 2)).toBe('000000000320000');
    });
  });

  // ─── Segment P ────────────────────────────────────────────────────────────

  describe('generateSegmentoP', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with bank code 237', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(0, 3)).toBe('237');
    });

    it('should have P at position 13', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[13]).toBe('P');
    });

    it('should have type 3 at position 7', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[7]).toBe('3');
    });

    it('should embed nossoNumero (padded to 20) at positions 37-56', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      const expected = mockBoleto.nossoNumero.padStart(20, '0');
      expect(line.substring(37, 57)).toBe(expected);
    });

    it('should encode due date at positions 77-84', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(77, 85)).toBe('30092026');
    });
  });

  // ─── Segment Q ────────────────────────────────────────────────────────────

  describe('generateSegmentoQ', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should have Q at position 13', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line[13]).toBe('Q');
    });

    it('should use type 02 for CNPJ payer', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(17, 19)).toBe('02');
    });

    it('should contain payer name at positions 34-73', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(34, 74).trim()).toBe('Empresa Teste Ltda');
    });

    it('should contain payer city at positions 114-128', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(114, 129).trim()).toBe('São Paulo');
    });
  });

  // ─── Segment R ────────────────────────────────────────────────────────────

  describe('generateSegmentoR', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateSegmentoR(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should have R at position 13', () => {
      const line = layout.generateSegmentoR(mockBoleto, 1, 1);
      expect(line[13]).toBe('R');
    });

    it('should encode multa code 2 (percentual) at position 65', () => {
      const line = layout.generateSegmentoR(mockBoleto, 1, 1);
      expect(line[65]).toBe('2');
    });
  });

  // ─── Header / Trailer Arquivo ─────────────────────────────────────────────

  describe('generateHeaderArquivo', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with 237', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line.substring(0, 3)).toBe('237');
    });

    it('should have type 0 at position 7', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line[7]).toBe('0');
    });

    it('should have lote 0000 at positions 3-6', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line.substring(3, 7)).toBe('0000');
    });
  });

  describe('generateTrailerArquivo', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateTrailerArquivo(1, 7);
      expect(line).toHaveLength(240);
    });

    it('should have type 9 at position 7', () => {
      const line = layout.generateTrailerArquivo(1, 7);
      expect(line[7]).toBe('9');
    });

    it('should have lote 9999 at positions 3-6', () => {
      const line = layout.generateTrailerArquivo(1, 7);
      expect(line.substring(3, 7)).toBe('9999');
    });
  });

  // ─── Full file generation ─────────────────────────────────────────────────

  describe('generateRemessaFile', () => {
    it('should generate all lines with exactly 240 characters', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      lines.forEach(line => {
        expect(line).toHaveLength(240);
      });
    });

    it('should produce 7 lines for 1 boleto', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(7);
    });

    it('should produce segments P, Q, R in correct positions', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines[2][13]).toBe('P');
      expect(lines[3][13]).toBe('Q');
      expect(lines[4][13]).toBe('R');
    });
  });

  // ─── Return file parser ───────────────────────────────────────────────────

  describe('parseRetornoLine', () => {
    it('should return null for short lines', () => {
      expect(layout.parseRetornoLine('short')).toBeNull();
    });

    it('should return null for lines from a different bank', () => {
      const line = '077' + '0'.repeat(237);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for non-detalhe lines', () => {
      const line = '237' + '0000' + '0' + ' '.repeat(233);
      expect(layout.parseRetornoLine(line.padEnd(240, ' '))).toBeNull();
    });

    it('should return null for non-P segment detalhe lines', () => {
      const line = '237' + '0001' + '3' + '00001' + 'Q' + ' '.repeat(225);
      expect(layout.parseRetornoLine(line.padEnd(240, ' '))).toBeNull();
    });

    it('should parse a valid segment P retorno for Bradesco', () => {
      let line = '237';         // 0-2  banco
      line += '0001';           // 3-6  lote
      line += '3';              // 7    tipo
      line += '00001';          // 8-12 seq
      line += 'P';              // 13   segmento
      line += ' ';              // 14
      line += '06';             // 15-16 ocorrência (Liquidação)
      line = line.padEnd(37, ' ');
      line += '00000000000010  '; // 37-56 nossoNumero
      line = line.padEnd(85, ' ');
      line += '000000000320000'; // 85-99 amount (3200.00)
      line = line.padEnd(137, ' ');
      line += '30092026';       // 137-144 paid date
      line = line.padEnd(143, ' ');
      line += '000000000320000'; // 143-157 paidAmount
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000000000010');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação');
      expect(result!.amount).toBe(3200.00);
    });

    it('should handle occurrence 09 (Baixa)', () => {
      let line = '237' + '0001' + '3' + '00001' + 'P' + ' ';
      line += '09'; // baixa
      line = line.padEnd(37, ' ');
      line += '00000000000010  ';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.occurrence).toBe('09');
      expect(result!.occurrenceDesc).toBe('Baixa');
    });

    it('should return unknown occurrence description for unmapped codes', () => {
      let line = '237' + '0001' + '3' + '00001' + 'P' + ' ';
      line += '99'; // unknown code
      line = line.padEnd(37, ' ');
      line += '00000000000010  ';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Ocorrência 99');
    });
  });
});
