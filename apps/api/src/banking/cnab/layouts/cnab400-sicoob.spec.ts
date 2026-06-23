import { Cnab400Sicoob } from './cnab400-sicoob';
import { Cnab400Boleto } from './cnab400-base';

const mockBankAccount = {
  id: 'account-sicoob400',
  name: 'Conta Sicoob CNAB400',
  bankCode: '756',
  agency: '3033',
  accountNumber: '9876543',
};

const mockBoleto: Cnab400Boleto = {
  id: 'boleto-sicoob400-1',
  companyId: 'company-1',
  bankAccountId: 'account-sicoob400',
  receivableId: null,
  nossoNumero: '00000005678',
  seuNumero: 'SCB400001',
  amount: 2500.75 as any,
  dueDate: new Date(2026, 7, 20), // Aug 20 2026
  status: 'PENDING' as any,
  payerName: 'Cooperativa Modelo',
  payerDocument: '55444333000177', // CNPJ
  payerAddress: 'Av. Cooperativa, 55',
  payerCity: 'Florianópolis',
  payerState: 'SC',
  payerZipCode: '88010000',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Cobrar juros após vencimento.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '98.765.432/0001-01',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab400Sicoob', () => {
  let layout: Cnab400Sicoob;

  beforeEach(() => {
    layout = new Cnab400Sicoob();
  });

  // ─── Utility methods ───────────────────────────────────────────────────────

  describe('padRight', () => {
    it('should pad with spaces', () => {
      expect(layout.padRight('SCB', 6)).toBe('SCB   ');
    });
  });

  describe('formatDate', () => {
    it('should format as DDMMAA (6 digits)', () => {
      const date = new Date(2026, 7, 20); // Aug 20 2026
      expect(layout.formatDate(date)).toBe('200826');
    });
  });

  describe('formatDecimal', () => {
    it('should format 2500.75 with 13 chars', () => {
      expect(layout.formatDecimal(2500.75, 13, 2)).toBe('0000000250075');
    });
  });

  // ─── Header ───────────────────────────────────────────────────────────────

  describe('generateHeader', () => {
    it('should generate exactly 400 characters', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line).toHaveLength(400);
    });

    it('should start with 0 (header)', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line[0]).toBe('0');
    });

    it('should have remessa operation 1 at position 1', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line[1]).toBe('1');
    });
  });

  // ─── Detail ───────────────────────────────────────────────────────────────

  describe('generateDetail', () => {
    it('should generate exactly 400 characters', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line).toHaveLength(400);
    });

    it('should start with 1 (detalhe)', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line[0]).toBe('1');
    });

    it('should contain nossoNumero at positions 38-48', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line.substring(38, 49).trim()).toBe('00000005678');
    });

    it('should encode due date DDMMAA at positions 82-87', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line.substring(82, 88)).toBe('200826');
    });
  });

  // ─── Trailer ──────────────────────────────────────────────────────────────

  describe('generateTrailer', () => {
    it('should generate exactly 400 characters', () => {
      const line = layout.generateTrailer(3, 2500.75);
      expect(line).toHaveLength(400);
    });

    it('should start with 9 (trailer)', () => {
      const line = layout.generateTrailer(3, 2500.75);
      expect(line[0]).toBe('9');
    });
  });

  // ─── Full file generation ─────────────────────────────────────────────────

  describe('generateRemessaFile', () => {
    it('should produce lines of exactly 400 characters', () => {
      const content = layout.generateRemessaFile(mockCompany, [mockBoleto], 1);
      const lines = content.split('\n').filter(l => l.length > 0);
      lines.forEach(line => {
        expect(line).toHaveLength(400);
      });
    });

    it('should produce 3 lines for 1 boleto', () => {
      const content = layout.generateRemessaFile(mockCompany, [mockBoleto], 1);
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(3);
    });

    it('should produce 4 lines for 2 boletos', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        [mockBoleto, { ...mockBoleto, id: 'boleto-sicoob400-2', nossoNumero: '00000005679' }],
        2,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(4);
    });

    it('should have header (0) at first line and trailer (9) at last', () => {
      const content = layout.generateRemessaFile(mockCompany, [mockBoleto], 1);
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines[0][0]).toBe('0');
      expect(lines[lines.length - 1][0]).toBe('9');
    });
  });

  // ─── Return file parser ───────────────────────────────────────────────────

  describe('parseRetornoLine', () => {
    it('should return null for lines shorter than 400 chars', () => {
      expect(layout.parseRetornoLine('short')).toBeNull();
      expect(layout.parseRetornoLine('756' + '0'.repeat(200))).toBeNull();
    });

    it('should return null for header lines (tipo 0)', () => {
      const line = '0' + ' '.repeat(399);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for trailer lines (tipo 9)', () => {
      const line = '9' + ' '.repeat(399);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should parse a valid detail retorno for Sicoob (liquidação)', () => {
      let line = '1';                          // pos 0: detalhe
      line += '02';                             // pos 1-2: CNPJ
      line = line.padEnd(38, ' ');
      line += '00000005678';                    // pos 38-48: nossoNumero
      line = line.padEnd(108, ' ');
      line += '06';                             // pos 108-109: ocorrência
      line += '200826';                         // pos 110-115: data pagamento
      line = line.padEnd(152, ' ');
      line += '0000000250075';                  // valor cobrado
      line += '0000000250075';                  // valor pago
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000005678');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação Normal');
      expect(result!.amount).toBe(2500.75);
      expect(result!.paidAmount).toBe(2500.75);
      expect(result!.paidAt).not.toBeNull();
      expect(result!.paidAt!.getDate()).toBe(20);
      expect(result!.paidAt!.getMonth()).toBe(7); // August = 7
    });

    it('should handle occurrence 09 (Baixa Automática)', () => {
      let line = '1' + '02';
      line = line.padEnd(38, ' ');
      line += '00000005678';
      line = line.padEnd(108, ' ');
      line += '09';
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Baixa Automática');
    });

    it('should handle Sicoob-specific occurrence 11 (Arquivo em Ser)', () => {
      let line = '1' + '02';
      line = line.padEnd(38, ' ');
      line += '00000005678';
      line = line.padEnd(108, ' ');
      line += '11';
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Arquivo em Ser');
    });

    it('should return null paidAt when date is 000000', () => {
      let line = '1' + '02';
      line = line.padEnd(38, ' ');
      line += '00000005678';
      line = line.padEnd(108, ' ');
      line += '06' + '000000'; // no date
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.paidAt).toBeNull();
    });
  });
});
