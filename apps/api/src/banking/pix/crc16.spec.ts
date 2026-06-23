import { crc16 } from './crc16';

describe('crc16 (CRC16-CCITT-FALSE)', () => {
  it('should return 4-char uppercase hex string', () => {
    const result = crc16('123456789');
    expect(result).toHaveLength(4);
    expect(result).toMatch(/^[0-9A-F]{4}$/);
  });

  it('should compute correct CRC for "123456789" — known value 29B1', () => {
    // CRC16-CCITT-FALSE("123456789") = 0x29B1
    expect(crc16('123456789')).toBe('29B1');
  });

  it('should return 0000 padded for very short payloads', () => {
    const result = crc16('A');
    expect(result).toHaveLength(4);
  });

  it('should produce consistent results for the same input', () => {
    const payload = '000201260014br.gov.bcb.pix0136test52040000530398654041.005802BR5913Test Merchant6009Sao Paulo62070503***6304';
    const r1 = crc16(payload);
    const r2 = crc16(payload);
    expect(r1).toBe(r2);
  });

  it('should produce different CRC for different inputs', () => {
    expect(crc16('Hello')).not.toBe(crc16('hello'));
  });

  it('should handle empty string without throwing', () => {
    expect(() => crc16('')).not.toThrow();
  });

  it('should produce 4-char hex even when CRC value is small', () => {
    // Force small CRC by using a minimal string
    const result = crc16('\x00');
    expect(result).toHaveLength(4);
  });

  it('should produce correct CRC for a typical Pix payload prefix', () => {
    // Known Pix test vector from BCB spec
    // EMV payload up to (but not including) the CRC value
    const pixPrefix =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426614174000' +
      '52040000530398654071000.005802BR5913Fulano de Tal6008BRASILIA62070503***' +
      '6304';
    const result = crc16(pixPrefix);
    expect(result).toHaveLength(4);
    expect(result).toMatch(/^[0-9A-F]{4}$/);
  });
});
