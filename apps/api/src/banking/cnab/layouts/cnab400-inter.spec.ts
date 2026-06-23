import { Cnab400Inter } from './cnab400-inter';
import { Cnab400Boleto } from './cnab400-base';

const mockBankAccount = {
  id: 'account-inter400',
  name: 'Conta Inter CNAB400',
  bankCode: '077',
  agency: '0001',
  accountNumber: '1234567',
};

const mockBoleto: Cnab400Boleto = {
  id: 'boleto-inter400-1',
  companyId: 'company-1',
  bankAccountId: 'account-inter400',
  receivableId: null,
  nossoNumero: '00000001234',
  seuNumero: 'INT400001',
  amount: 1200.00 as any,
  dueDate: new Date(2026, 5, 30), // Jun 30 2026
  status: 'PENDING' as any,
  payerName: 'Cliente CNAB400',
  payerDocument: '12345678901', // CPF
  payerAddress: 'Rua Teste, 123',
  payerCity: 'Porto Alegre',
  payerState: 'RS',
  payerZipCode: '90010000',
  registeredAt: null,
  paidAt: null,
  paidAmount: null,
  cancelledAt: null,
  instructions: 'Pagar até o vencimento.',
  createdAt: new Date(),
  updatedAt: new Date(),
  bankAccount: mockBankAccount,
};

const mockCompany = {
  cnpj: '12.345.678/0001-00',
  name: 'GDR REBOQUES LTDA',
};

describe('Cnab400Inter', () => {
  let layout: Cnab400Inter;

  beforeEach(() => {
    layout = new Cnab400Inter();
  });

  // ─── Utility methods ───────────────────────────────────────────────────────

  describe('padRight', () => {
    it('should pad with spaces', () => {
      expect(layout.padRight('ABC', 6)).toBe('ABC   ');
    });
    it('should truncate long strings', () => {
      expect(layout.padRight('ABCDEF', 3)).toBe('ABC');
    });
  });

  describe('padLeft', () => {
    it('should pad with zeros by default', () => {
      expect(layout.padLeft('42', 6)).toBe('000042');
    });
  });

  describe('formatDate', () => {
    it('should format as DDMMAA (6 digits)', () => {
      const date = new Date(2026, 5, 30); // Jun 30 2026
      expect(layout.formatDate(date)).toBe('300626');
    });
    it('should use 2-digit year', () => {
      const date = new Date(2030, 0, 1); // Jan 1 2030
      expect(layout.formatDate(date)).toBe('010130');
    });
  });

  describe('formatDecimal', () => {
    it('should format 1200.00 with 13 chars, 2 decimals', () => {
      expect(layout.formatDecimal(1200.00, 13, 2)).toBe('0000000120000');
    });
  });

  // ─── Header ───────────────────────────────────────────────────────────────

  describe('generateHeader', () => {
    it('should generate exactly 400 characters', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line).toHaveLength(400);
    });

    it('should start with 0 (tipo registro = header)', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line[0]).toBe('0');
    });

    it('should have operation type 1 (remessa) at position 1', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line[1]).toBe('1');
    });

    it('should contain REMESSA literal at positions 2-8', () => {
      const line = layout.generateHeader(mockCompany, 1);
      expect(line.substring(2, 9)).toBe('REMESSA');
    });
  });

  // ─── Detail ───────────────────────────────────────────────────────────────

  describe('generateDetail', () => {
    it('should generate exactly 400 characters', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line).toHaveLength(400);
    });

    it('should start with 1 (tipo registro = detalhe)', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line[0]).toBe('1');
    });

    it('should contain nossoNumero at positions 38-48', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line.substring(38, 49).trim()).toBe('00000001234');
    });

    it('should encode due date at positions 82-87 (DDMMAA)', () => {
      const line = layout.generateDetail(mockBoleto, 1);
      expect(line.substring(82, 88)).toBe('300626');
    });
  });

  // ─── Trailer ──────────────────────────────────────────────────────────────

  describe('generateTrailer', () => {
    it('should generate exactly 400 characters', () => {
      const line = layout.generateTrailer(3, 1200.00);
      expect(line).toHaveLength(400);
    });

    it('should start with 9 (tipo registro = trailer)', () => {
      const line = layout.generateTrailer(3, 1200.00);
      expect(line[0]).toBe('9');
    });
  });

  // ─── Full file generation ─────────────────────────────────────────────────

  describe('generateRemessaFile', () => {
    it('should generate all lines with exactly 400 characters', () => {
      const content = layout.generateRemessaFile(mockCompany, [mockBoleto], 1);
      const lines = content.split('\n').filter(l => l.length > 0);
      lines.forEach(line => {
        expect(line).toHaveLength(400);
      });
    });

    it('should produce 3 lines for 1 boleto (header + detail + trailer)', () => {
      const content = layout.generateRemessaFile(mockCompany, [mockBoleto], 1);
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(3);
    });

    it('should produce 4 lines for 2 boletos', () => {
      const content = layout.generateRemessaFile(
        mockCompany,
        [mockBoleto, { ...mockBoleto, id: 'boleto-inter400-2', nossoNumero: '00000001235' }],
        2,
      );
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(4);
    });

    it('should have header at line 0, trailer at last line', () => {
      const content = layout.generateRemessaFile(mockCompany, [mockBoleto], 1);
      const lines = content.split('\n').filter(l => l.length > 0);
      expect(lines[0][0]).toBe('0'); // header
      expect(lines[lines.length - 1][0]).toBe('9'); // trailer
    });
  });

  // ─── Return file parser ───────────────────────────────────────────────────

  describe('parseRetornoLine', () => {
    it('should return null for lines shorter than 400 chars', () => {
      expect(layout.parseRetornoLine('short')).toBeNull();
    });

    it('should return null for header lines (tipo 0)', () => {
      const line = '0' + ' '.repeat(399);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should return null for trailer lines (tipo 9)', () => {
      const line = '9' + ' '.repeat(399);
      expect(layout.parseRetornoLine(line)).toBeNull();
    });

    it('should parse a valid detail retorno line', () => {
      let line = '1';                          // pos 0: tipo detalhe
      line += '01';                             // pos 1-2: tipo inscrição
      line = line.padEnd(38, ' ');
      line += '00000001234';                    // pos 38-48: nossoNumero (11)
      line = line.padEnd(108, ' ');
      line += '06';                             // pos 108-109: ocorrência (liquidação normal)
      line += '300626';                         // pos 110-115: data pagamento (DDMMAA)
      line = line.padEnd(152, ' ');
      line += '0000000120000';                  // pos 152-164: valor cobrado
      line += '0000000120000';                  // pos 165-177: valor pago
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);

      expect(result).not.toBeNull();
      expect(result!.nossoNumero).toBe('00000001234');
      expect(result!.occurrence).toBe('06');
      expect(result!.occurrenceDesc).toBe('Liquidação Normal');
      expect(result!.amount).toBe(1200.00);
      expect(result!.paidAmount).toBe(1200.00);
      expect(result!.paidAt).not.toBeNull();
      expect(result!.paidAt!.getDate()).toBe(30);
      expect(result!.paidAt!.getMonth()).toBe(5); // June = 5
    });

    it('should handle occurrence 09 (Baixa Automática)', () => {
      let line = '1' + '01';
      line = line.padEnd(38, ' ');
      line += '00000001234';
      line = line.padEnd(108, ' ');
      line += '09';
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.occurrenceDesc).toBe('Baixa Automática');
    });

    it('should return null paidAt when date is 000000', () => {
      let line = '1' + '01';
      line = line.padEnd(38, ' ');
      line += '00000001234';
      line = line.padEnd(108, ' ');
      line += '06' + '000000'; // date=000000 → no paid date
      line = line.padEnd(400, ' ');

      const result = layout.parseRetornoLine(line);
      expect(result).not.toBeNull();
      expect(result!.paidAt).toBeNull();
    });
  });
});
