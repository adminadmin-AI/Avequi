import { Cnab240BB } from './cnab240-bb';
import { CnabBoleto } from './cnab240-base';

const mockBankAccount = {
  id: 'account-bb',
  name: 'Conta BB',
  bankCode: '001',
  agency: '0001',
  accountNumber: '11223-4',
};

const mockBoleto: CnabBoleto = {
  id: 'boleto-bb-1',
  companyId: 'company-1',
  bankAccountId: 'account-bb',
  receivableId: null,
  nossoNumero: '00000000000030',
  seuNumero: 'BB001',
  amount: 8900.75 as any,
  dueDate: new Date(2026, 11, 31), // Dec 31 2026
  status: 'PENDING' as any,
  payerName: 'Construtora ABC S.A.',
  payerDocument: '99888777000166', // CNPJ
  payerAddress: 'SQN 201 Bloco A',
  payerCity: 'Brasília',
  payerState: 'DF',
  payerZipCode: '70830010',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Proteste após 30 dias do vencimento.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '12.345.678/0001-00',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab240BB', () => {
  let layout: Cnab240BB;

  beforeEach(() => {
    layout = new Cnab240BB();
  });

  // ─── Utility methods ───────────────────────────────────────────────────────

  describe('padRight', () => {
    it('should pad string with spaces', () => {
      expect(layout.padRight('BB', 5)).toBe('BB   ');
    });
  });

  describe('padLeft', () => {
    it('should pad with zeros', () => {
      expect(layout.padLeft('1', 3)).toBe('001');
    });
  });

  describe('formatDate', () => {
    it('should format date as DDMMAAAA', () => {
      const date = new Date(2026, 11, 31); // Dec 31 2026
      expect(layout.formatDate(date)).toBe('31122026');
    });
  });

  describe('formatDecimal', () => {
    it('should format 8900.75 correctly', () => {
      expect(layout.formatDecimal(8900.75, 15, 2)).toBe('000000000890075');
    });
  });

  // ─── Segment P ────────────────────────────────────────────────────────────

  describe('generateSegmentoP', () => {
    it('should generate exactly 240 characters', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line).toHaveLength(240);
    });

    it('should start with bank code 001', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(0, 3)).toBe('001');
    });

    it('should have P at position 13', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[13]).toBe('P');
    });

    it('should have type 3 at position 7', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line[7]).toBe('3');
    });

    it('should embed nossoNumero at positions 37-56', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      const expected = mockBoleto.nossoNumero.padStart(20, '0');
      expect(line.substring(37, 57)).toBe(expected);
    });

    it('should encode due date at positions 77-84', () => {
      const line = layout.generateSegmentoP(mockBoleto, 1, 1);
      expect(line.substring(77, 85)).toBe('31122026');
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

    it('should contain payer city at positions 114-128', () => {
      const line = layout.generateSegmentoQ(mockBoleto, 1, 1);
      expect(line.substring(114, 129).trim()).toBe('Brasília');
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

    it('should start with 001', () => {
      expect(layout.generateHeaderArquivo(mockCompany, 1).substring(0, 3)).toBe('001');
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
    it('should produce 7 lines for 1 boleto, all 240 chars', () => {
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
        [mockBoleto, { ...mockBoleto, id: 'boleto-bb-2', nossoNumero: '00000000000031' }],
        2,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(10);
    });

    it('should have P, Q, R in correct positions', () => {
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
      expect(layout.parseRetornoLine('001')).toBeNull();
    });

    it('should return null for wrong bank code', () => {
      const line = '341' + '0'.repeat(237);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for non-detalhe lines', () => {
      const line = ('001' + '0000' + '0' + ' '.repeat(233)).padEnd(240, ' ');
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should parse a valid segment P retorno for BB (liquidação normal)', () => {
      let line = '001';         // banco
      line += '0001';
      line += '3';
      line += '00001';
      line += 'P';
      line += ' ';
      line += '06';             // Liquidação Normal
      line = line.padEnd(37, ' ');
      line += '00000000000030  '; // nossoNumero
      line = line.padEnd(85, ' ');
      line += '000000000890075'; // 8900.75
      line = line.padEnd(137, ' ');
      line += '31122026';       // paid date
      line = line.padEnd(143, ' ');
      line += '000000000890075';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000000000030');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação Normal');
      expect(result!.amount).toBe(8900.75);
      expect(result!.paidAt).not.toBeNull();
      expect(result!.paidAt!.getDate()).toBe(31);
      expect(result!.paidAt!.getMonth()).toBe(11); // December = 11
      expect(result!.paidAt!.getFullYear()).toBe(2026);
    });

    it('should handle BB-specific occurrence 05 (Liquidação sem Registro)', () => {
      let line = '001' + '0001' + '3' + '00001' + 'P' + ' ' + '05';
      line = line.padEnd(37, ' ');
      line += '00000000000030  ';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Liquidação sem Registro');
    });

    it('should handle occurrence 09 (Baixa)', () => {
      let line = '001' + '0001' + '3' + '00001' + 'P' + ' ' + '09';
      line = line.padEnd(37, ' ');
      line += '00000000000030  ';
      line = line.padEnd(240, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Baixa');
    });
  });
});
