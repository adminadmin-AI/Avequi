import { Cnab240Inter } from './cnab240-inter';
import { CnabBoleto } from './cnab240-base';

const mockBankAccount = {
  id: 'account-1',
  name: 'Conta Inter',
  bankCode: '077',
  agency: '0001',
  accountNumber: '123456-7',
};

const mockBoleto: CnabBoleto = {
  id: 'boleto-1',
  companyId: 'company-1',
  bankAccountId: 'account-1',
  receivableId: null,
  nossoNumero: '00000000000001',
  seuNumero: 'REF001',
  amount: 1500.75 as any,
  dueDate: new Date(2026, 6, 31), // Jul 31 2026, local time
  status: 'PENDING' as any,
  payerName: 'João Silva',
  payerDocument: '12345678901',
  payerAddress: 'Rua das Flores, 100',
  payerCity: 'São Paulo',
  payerState: 'SP',
  payerZipCode: '01310100',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Não receber após o vencimento.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '12.345.678/0001-00',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab240Inter', () => {
  let layout: Cnab240Inter;

  beforeEach(() => {
    layout = new Cnab240Inter();
  });

  // ─── Utility methods ───────────────────────────────────────────────────────

  describe('padRight', () => {
    it('should pad string to the right with spaces', () => {
      expect(layout.padRight('ABC', 6)).toBe('ABC   ');
    });
    it('should truncate strings longer than length', () => {
      expect(layout.padRight('ABCDEFGH', 5)).toBe('ABCDE');
    });
    it('should handle empty string', () => {
      expect(layout.padRight('', 3)).toBe('   ');
    });
  });

  describe('padLeft', () => {
    it('should pad number to the left with zeros', () => {
      expect(layout.padLeft('42', 6)).toBe('000042');
    });
    it('should pad string to the left with zeros', () => {
      expect(layout.padLeft('abc', 5)).toBe('00abc');
    });
    it('should pad number type', () => {
      expect(layout.padLeft(7, 4)).toBe('0007');
    });
  });

  describe('formatDate', () => {
    it('should format date as DDMMAAAA', () => {
      const date = new Date(2026, 6, 31); // Jul 31 2026 local time
      expect(layout.formatDate(date)).toBe('31072026');
    });
    it('should zero-pad single digit day and month', () => {
      const date = new Date(2026, 0, 5); // Jan 5 2026 local time
      expect(layout.formatDate(date)).toBe('05012026');
    });
  });

  describe('formatDecimal', () => {
    it('should format 1500.75 as integer representation', () => {
      expect(layout.formatDecimal(1500.75, 15, 2)).toBe('000000000150075');
    });
    it('should format 0 correctly', () => {
      expect(layout.formatDecimal(0, 13, 2)).toBe('0000000000000');
    });
    it('should handle integers', () => {
      expect(layout.formatDecimal(100, 10, 2)).toBe('0000010000');
    });
  });

  // ─── Segment P ────────────────────────────────────────────────────────────

  describe('generateSegmentoP', () => {
    it('should generate a segment P with exactly 240 characters', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with bank code 077', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(0, 3)).toBe('077');
    });

    it('should have segment identifier P at position 13 (0-indexed)', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[13]).toBe('P');
    });

    it('should have type 3 at position 7 (detalhe)', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[7]).toBe('3');
    });

    it('should contain nossoNumero (padded to 20) at positions 37-56', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      // nossoNumero is left-padded to 20 chars in the layout
      const expected = mockBoleto.nossoNumero.padStart(20, '0');
      expect(line.substring(37, 57)).toBe(expected);
    });
  });

  // ─── Segment Q ────────────────────────────────────────────────────────────

  describe('generateSegmentoQ', () => {
    it('should generate a segment Q with exactly 240 characters', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should have segment identifier Q at position 13', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line[13]).toBe('Q');
    });

    it('should contain payer name at positions 34-73', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(34, 74).trim()).toBe('João Silva');
    });

    it('should contain payer city at positions 114-128', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(114, 129).trim()).toBe('São Paulo');
    });
  });

  // ─── Segment R ────────────────────────────────────────────────────────────

  describe('generateSegmentoR', () => {
    it('should generate a segment R with exactly 240 characters', () => {
      const line = layout.generateSegmentoR(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should have segment identifier R at position 13', () => {
      const line = layout.generateSegmentoR(mockBoleto, 1, 1);
      expect(line[13]).toBe('R');
    });
  });

  // ─── Header Arquivo ───────────────────────────────────────────────────────

  describe('generateHeaderArquivo', () => {
    it('should generate header with exactly 240 characters', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with bank code 077', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line.substring(0, 3)).toBe('077');
    });

    it('should have type 0 at position 7 (header arquivo)', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line[7]).toBe('0');
    });

    it('should have lote 0000 at positions 3-6', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line.substring(3, 7)).toBe('0000');
    });
  });

  // ─── Trailer Arquivo ──────────────────────────────────────────────────────

  describe('generateTrailerArquivo', () => {
    it('should generate trailer with exactly 240 characters', () => {
      const line = layout.generateTrailerArquivo(1, 10);
      expect(line).toHaveLength(240);
    });

    it('should have type 9 at position 7 (trailer arquivo)', () => {
      const line = layout.generateTrailerArquivo(1, 10);
      expect(line[7]).toBe('9');
    });

    it('should have lote 9999 at positions 3-6', () => {
      const line = layout.generateTrailerArquivo(1, 10);
      expect(line.substring(3, 7)).toBe('9999');
    });
  });

  // ─── Full file generation ─────────────────────────────────────────────────

  describe('generateRemessaFile', () => {
    it('should generate a valid CNAB 240 file', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      expect(content).toBeTruthy();
    });

    it('should have all lines exactly 240 characters long', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      lines.forEach((line, idx) => {
        expect(line.length).toBe(240); // line ${idx}
      });
    });

    it('should produce 6 lines for 1 boleto (header + headerLote + P + Q + R + trailerLote + trailerArquivo = 7)', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      // 1 header + 1 header lote + 3 segments + 1 trailer lote + 1 trailer arquivo = 7
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
      // Lines: [0]=headerArquivo, [1]=headerLote, [2]=segP, [3]=segQ, [4]=segR, [5]=trailerLote, [6]=trailerArquivo
      expect(lines[2][13]).toBe('P');
      expect(lines[3][13]).toBe('Q');
      expect(lines[4][13]).toBe('R');
    });
  });

  // ─── Return file parser ───────────────────────────────────────────────────

  describe('parseRetornoLine', () => {
    it('should return null for lines shorter than 240 chars', () => {
      expect(layout.parseRetornoLine('short')).toBeNull();
    });

    it('should return null for lines from a different bank', () => {
      const line = '756' + '0'.repeat(237);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for non-detalhe lines (tipo != 3)', () => {
      // header arquivo: type at pos 7 = '0'
      const line = '077' + '0001' + '0' + ' '.repeat(233);
      expect(layout.parseRetornoLine(line.padEnd(240, ' '))).toBeNull();
    });

    it('should parse a valid segment P line from retorno', () => {
      // Build a synthetic 240-char retorno segment P for Inter
      // pos 0-2: bank, pos 3-6: lote, pos 7: tipo=3, pos 8-12: seq, pos 13: P, pos 14: space
      // pos 15-16: occurrence code, pos 37-56: nossoNumero, pos 85-99: amount, pos 110-117: date
      let line = '077';         // 0-2
      line += '0001';           // 3-6
      line += '3';              // 7
      line += '00001';          // 8-12
      line += 'P';              // 13
      line += ' ';              // 14
      line += '06';             // 15-16 (liquidação normal)
      line = line.padEnd(37, ' ');
      line += '00000000000001  '; // 37-56 (nossoNumero, 20 chars)
      line = line.padEnd(85, ' ');
      line += '000000000150075'; // 85-99 amount (1500.75)
      line = line.padEnd(110, ' ');
      line += '31072026';       // 110-117 paid date DDMMAAAA
      line = line.padEnd(143, ' ');
      line += '000000000150075'; // 143-157 paidAmount
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000000000001');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação Normal');
      expect(result!.amount).toBe(1500.75);
    });
  });
});
