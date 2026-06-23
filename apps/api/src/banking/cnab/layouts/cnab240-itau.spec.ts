import { Cnab240Itau } from './cnab240-itau';
import { CnabBoleto } from './cnab240-base';

const mockBankAccount = {
  id: 'account-itau',
  name: 'Conta Itaú',
  bankCode: '341',
  agency: '4321',
  accountNumber: '87654-3',
};

const mockBoleto: CnabBoleto = {
  id: 'boleto-itau-1',
  companyId: 'company-1',
  bankAccountId: 'account-itau',
  receivableId: null,
  nossoNumero: '00000000000020',
  seuNumero: 'ITA001',
  amount: 5000.50 as any,
  dueDate: new Date(2026, 10, 15), // Nov 15 2026
  status: 'PENDING' as any,
  payerName: 'Pedro Alves',
  payerDocument: '98765432100', // CPF (11 digits)
  payerAddress: 'Av. Paulista, 1000',
  payerCity: 'São Paulo',
  payerState: 'SP',
  payerZipCode: '01310000',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Após vencimento cobrar juros de 1% ao mês.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '12.345.678/0001-00',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab240Itau', () => {
  let layout: Cnab240Itau;

  beforeEach(() => {
    layout = new Cnab240Itau();
  });

  // ─── Utility methods ───────────────────────────────────────────────────────

  describe('padRight', () => {
    it('should pad string with spaces', () => {
      expect(layout.padRight('ITAU', 8)).toBe('ITAU    ');
    });
  });

  describe('padLeft', () => {
    it('should pad with zeros', () => {
      expect(layout.padLeft('9', 5)).toBe('00009');
    });
  });

  describe('formatDate', () => {
    it('should format date as DDMMAAAA', () => {
      const date = new Date(2026, 10, 15); // Nov 15 2026
      expect(layout.formatDate(date)).toBe('15112026');
    });
  });

  describe('formatDecimal', () => {
    it('should format 5000.50 correctly', () => {
      expect(layout.formatDecimal(5000.50, 15, 2)).toBe('000000000500050');
    });
  });

  // ─── Segment P ────────────────────────────────────────────────────────────

  describe('generateSegmentoP', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with bank code 341', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(0, 3)).toBe('341');
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
      expect(line.substring(77, 85)).toBe('15112026');
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

    it('should use type 01 for CPF payer (11 digits)', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(17, 19)).toBe('01');
    });

    it('should contain payer name at positions 34-73', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(34, 74).trim()).toBe('Pedro Alves');
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
  });

  // ─── Header / Trailer ─────────────────────────────────────────────────────

  describe('generateHeaderArquivo', () => {
    it('should generate exactly 240 characters', () => {
      expect(layout.generateHeaderArquivo(mockCompany, 1)).toHaveLength(240);
    });

    it('should start with 341', () => {
      expect(layout.generateHeaderArquivo(mockCompany, 1).substring(0, 3)).toBe('341');
    });
  });

  describe('generateTrailerArquivo', () => {
    it('should generate exactly 240 characters', () => {
      expect(layout.generateTrailerArquivo(1, 7)).toHaveLength(240);
    });

    it('should have 9999 lote and type 9', () => {
      const line = layout.generateTrailerArquivo(1, 7);
      expect(line.substring(3, 7)).toBe('9999');
      expect(line[7]).toBe('9');
    });
  });

  // ─── Full file generation ─────────────────────────────────────────────────

  describe('generateRemessaFile', () => {
    it('should produce 7 lines for 1 boleto all exactly 240 chars', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto],
        1,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(7);
      lines.forEach(line => expect(line).toHaveLength(240));
    });

    it('should produce 10 lines for 2 boletos', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        mockBankAccount,
        [mockBoleto, { ...mockBoleto, id: 'boleto-itau-2', nossoNumero: '00000000000021' }],
        2,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(10);
    });

    it('should have P, Q, R segments in correct positions', () => {
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
      expect(layout.parseRetornoLine('341')).toBeNull();
    });

    it('should return null for wrong bank code', () => {
      const line = '237' + '0'.repeat(237);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for non-detalhe lines', () => {
      const line = ('341' + '0000' + '0' + ' '.repeat(233)).padEnd(240, ' ');
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should parse a valid segment P retorno for Itaú', () => {
      let line = '341';         // 0-2  banco
      line += '0001';           // 3-6
      line += '3';              // 7
      line += '00001';          // 8-12
      line += 'P';              // 13
      line += ' ';              // 14
      line += '06';             // 15-16 Liquidação Normal
      line = line.padEnd(37, ' ');
      line += '00000000000020  '; // nossoNumero
      line = line.padEnd(85, ' ');
      line += '000000000500050'; // 5000.50
      line = line.padEnd(137, ' ');
      line += '15112026';       // paid date
      line = line.padEnd(143, ' ');
      line += '000000000500050';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000000000020');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação Normal');
      expect(result!.amount).toBe(5000.50);
    });

    it('should handle occurrence 09 (Baixado)', () => {
      let line = '341' + '0001' + '3' + '00001' + 'P' + ' ' + '09';
      line = line.padEnd(37, ' ');
      line += '00000000000020  ';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Baixado');
    });
  });
});
