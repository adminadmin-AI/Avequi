import { Cnab240Sicoob } from './cnab240-sicoob';
import { CnabBoleto } from './cnab240-base';

const mockBankAccount = {
  id: 'account-1',
  name: 'Conta Sicoob',
  bankCode: '756',
  agency: '3033',
  accountNumber: '98765-4',
};

const mockBoleto: CnabBoleto = {
  id: 'boleto-2',
  companyId: 'company-1',
  bankAccountId: 'account-1',
  receivableId: null,
  nossoNumero: '00000000000002',
  seuNumero: 'SREF002',
  amount: 2750.50 as any,
  dueDate: new Date(2026, 7, 15), // Aug 15 2026, local time
  status: 'PENDING' as any,
  payerName: 'Maria Souza',
  payerDocument: '98765432000101',  // CNPJ
  payerAddress: 'Av. Brasil, 500',
  payerCity: 'Curitiba',
  payerState: 'PR',
  payerZipCode: '80010000',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Após vencimento cobrar multa de 2%.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '98.765.432/0001-01',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab240Sicoob', () => {
  let layout: Cnab240Sicoob;

  beforeEach(() => {
    layout = new Cnab240Sicoob();
  });

  // ─── Utility methods (inherited from base) ────────────────────────────────

  describe('padRight (inherited)', () => {
    it('should pad string with spaces', () => {
      expect(layout.padRight('TEST', 8)).toBe('TEST    ');
    });
  });

  describe('padLeft (inherited)', () => {
    it('should pad with zeros by default', () => {
      expect(layout.padLeft('5', 4)).toBe('0005');
    });
  });

  describe('formatDate (inherited)', () => {
    it('should format date as DDMMAAAA', () => {
      const date = new Date(2026, 7, 15); // Aug 15 2026 local time
      expect(layout.formatDate(date)).toBe('15082026');
    });
  });

  describe('formatDecimal (inherited)', () => {
    it('should format 2750.50 correctly', () => {
      expect(layout.formatDecimal(2750.50, 15, 2)).toBe('000000000275050');
    });
  });

  // ─── Segment P ────────────────────────────────────────────────────────────

  describe('generateSegmentoP', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with bank code 756', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(0, 3)).toBe('756');
    });

    it('should have P at position 13', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[13]).toBe('P');
    });

    it('should have type 3 (detalhe) at position 7', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[7]).toBe('3');
    });

    it('should embed nossoNumero (padded to 20) at positions 37-56', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      // nossoNumero is left-padded to 20 chars in the layout
      const expected = mockBoleto.nossoNumero.padStart(20, '0');
      expect(line.substring(37, 57)).toBe(expected);
    });

    it('should encode due date at positions 77-84 (0-indexed)', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      // Due date 2026-08-15 → 15082026
      expect(line.substring(77, 85)).toBe('15082026');
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
      // Positions 17-18 (0-indexed) = tipo inscrição sacado
      expect(line.substring(17, 19)).toBe('02');
    });

    it('should contain payer city at correct position', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(114, 129).trim()).toBe('Curitiba');
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

    it('should encode multa code as 2 (percentual) at position 65', () => {
      const line = layout.generateSegmentoR(mockBoleto, 1, 1);
      expect(line[65]).toBe('2');
    });
  });

  // ─── Header / Trailer ─────────────────────────────────────────────────────

  describe('generateHeaderArquivo', () => {
    it('should generate 240 characters', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with 756', () => {
      const line = layout.generateHeaderArquivo(mockCompany, 1);
      expect(line.substring(0, 3)).toBe('756');
    });
  });

  describe('generateTrailerArquivo', () => {
    it('should generate 240 characters', () => {
      const line = layout.generateTrailerArquivo(1, 7);
      expect(line).toHaveLength(240);
    });

    it('should have 9 at position 7 and 9999 at positions 3-6', () => {
      const line = layout.generateTrailerArquivo(1, 7);
      expect(line[7]).toBe('9');
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

    it('should produce 10 lines for 2 boletos', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto, { ...mockBoleto, id: 'boleto-3', nossoNumero: '00000000000003' }],
        2,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      // 1 headerArq + 1 headerLote + 6 segments (3*2) + 1 trailerLote + 1 trailerArq = 10
      expect(lines).toHaveLength(10);
    });

    it('should start first line with 756 (bank code)', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const firstLine = content.split('\n')[0];
      expect(firstLine.substring(0, 3)).toBe('756');
    });
  });

  // ─── Return file parser ───────────────────────────────────────────────────

  describe('parseRetornoLine', () => {
    it('should return null for short lines', () => {
      expect(layout.parseRetornoLine('')).toBeNull();
      expect(layout.parseRetornoLine('756')).toBeNull();
    });

    it('should return null for lines from Inter (different bank)', () => {
      const line = '077' + '0'.repeat(237);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for header lines (tipo != 3)', () => {
      const line = '756' + '9999' + '9' + ' '.repeat(233);
      expect(layout.parseRetornoLine(line.padEnd(240, ' '))).toBeNull();
    });

    it('should return null for non-P segment detalhe lines', () => {
      let line = '756' + '0001' + '3' + '00001' + 'Q' + ' '.repeat(225);
      line = line.padEnd(240, ' ');
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should parse a valid retorno segment P for Sicoob', () => {
      let line = '756';         // 0-2  banco
      line += '0001';           // 3-6  lote
      line += '3';              // 7    tipo (detalhe)
      line += '00001';          // 8-12 sequência
      line += 'P';              // 13   segmento
      line += ' ';              // 14
      line += '06';             // 15-16 ocorrência (liquidação normal)
      line = line.padEnd(37, ' ');
      line += '00000000000002  '; // 37-56 nossoNumero (20 chars)
      line = line.padEnd(85, ' ');
      line += '000000000275050'; // 85-99 amount (2750.50)
      line = line.padEnd(137, ' ');
      line += '15082026';       // 137-144 paid date (Sicoob position)
      line = line.padEnd(143, ' ');
      line += '000000000275050'; // 143-157 paidAmount
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000000000002');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação Normal');
      expect(result!.amount).toBe(2750.50);
    });

    it('should handle occurrence 09 (baixa automática)', () => {
      let line = '756' + '0001' + '3' + '00001' + 'P' + ' ';
      line += '09';  // baixa automática
      line = line.padEnd(37, ' ');
      line += '00000000000002  ';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.occurrence).toBe('09');
      expect(result!.occurrenceDesc).toBe('Baixa Automática');
    });
  });
});
