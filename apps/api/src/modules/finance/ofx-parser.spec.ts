import { parseOfx } from './ofx-parser';

describe('OFX Parser', () => {
  const sampleOfx = `
OFXHEADER:100
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260615
<TRNAMT>-1500.50
<FITID>202606150001
<MEMO>PAGAMENTO FORNECEDOR
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260616
<TRNAMT>3200.00
<FITID>202606160001
<MEMO>RECEBIMENTO CLIENTE
<CHECKNUM>BOL123
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`;

  it('should parse OFX transactions correctly', () => {
    const txns = parseOfx(sampleOfx);
    expect(txns).toHaveLength(2);
  });

  it('should extract DEBIT with correct amount', () => {
    const txns = parseOfx(sampleOfx);
    expect(txns[0].type).toBe('DEBIT');
    expect(txns[0].amount).toBe(1500.50);
    expect(txns[0].description).toBe('PAGAMENTO FORNECEDOR');
  });

  it('should extract CREDIT with reference', () => {
    const txns = parseOfx(sampleOfx);
    expect(txns[1].type).toBe('CREDIT');
    expect(txns[1].amount).toBe(3200);
    expect(txns[1].reference).toBe('BOL123');
  });

  it('should parse date correctly', () => {
    const txns = parseOfx(sampleOfx);
    expect(txns[0].date.getFullYear()).toBe(2026);
    expect(txns[0].date.getMonth()).toBe(5); // June = 5
  });
});
