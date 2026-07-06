import {
  base32Decode,
  base32Encode,
  buildOtpAuthUri,
  generateTotpSecret,
  totpCode,
  verifyTotp,
  TOTP_STEP_SECONDS,
} from './totp.util';

/**
 * Vetores oficiais da RFC 6238 (Appendix B), modo SHA-1:
 * secret ASCII "12345678901234567890" → base32 GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ.
 * A RFC lista códigos de 8 dígitos; os 6 finais são o código de 6 dígitos.
 */
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_VECTORS: Array<[number, string]> = [
  [59, '287082'], // RFC: 94287082
  [1111111109, '081804'], // RFC: 07081804
  [1111111111, '050471'], // RFC: 14050471
  [1234567890, '005924'], // RFC: 89005924
  [2000000000, '279037'], // RFC: 69279037
];

describe('totp.util — RFC 6238 (#344)', () => {
  describe('base32', () => {
    it('should round-trip encode/decode', () => {
      const data = Buffer.from('12345678901234567890', 'ascii');
      expect(base32Encode(data)).toBe(RFC_SECRET_B32);
      expect(base32Decode(RFC_SECRET_B32).equals(data)).toBe(true);
    });

    it('should be case-insensitive and ignore spaces/padding on decode', () => {
      const data = Buffer.from('12345678901234567890', 'ascii');
      expect(base32Decode('gezdgnbvgy3tqojq gezdgnbvgy3tqojq==').equals(data)).toBe(true);
    });

    it('should reject invalid characters', () => {
      expect(() => base32Decode('ABC!DEF')).toThrow('base32 inválido');
    });
  });

  describe('totpCode — vetores oficiais da RFC 6238', () => {
    it.each(RFC_VECTORS)('T=%is → %s', (t, expected) => {
      expect(totpCode(RFC_SECRET_B32, t * 1000)).toBe(expected);
    });
  });

  describe('verifyTotp', () => {
    const now = 1111111111 * 1000;

    it('should accept the current-step code', () => {
      expect(verifyTotp(RFC_SECRET_B32, '050471', 1, now)).toBe(true);
    });

    it('should accept codes from ±1 step (janela de clock skew)', () => {
      const prev = totpCode(RFC_SECRET_B32, now - TOTP_STEP_SECONDS * 1000);
      const next = totpCode(RFC_SECRET_B32, now + TOTP_STEP_SECONDS * 1000);
      expect(verifyTotp(RFC_SECRET_B32, prev, 1, now)).toBe(true);
      expect(verifyTotp(RFC_SECRET_B32, next, 1, now)).toBe(true);
    });

    it('should reject codes 2+ steps away', () => {
      const old = totpCode(RFC_SECRET_B32, now - 2 * TOTP_STEP_SECONDS * 1000);
      expect(verifyTotp(RFC_SECRET_B32, old, 1, now)).toBe(false);
    });

    it('should reject wrong / malformed codes', () => {
      expect(verifyTotp(RFC_SECRET_B32, '000000', 1, now)).toBe(false);
      expect(verifyTotp(RFC_SECRET_B32, '12345', 1, now)).toBe(false);
      expect(verifyTotp(RFC_SECRET_B32, 'abcdef', 1, now)).toBe(false);
      expect(verifyTotp(RFC_SECRET_B32, '', 1, now)).toBe(false);
    });

    it('should tolerate whitespace in the typed code', () => {
      expect(verifyTotp(RFC_SECRET_B32, '050 471', 1, now)).toBe(true);
    });
  });

  describe('generateTotpSecret', () => {
    it('should generate 160-bit base32 secrets, unique per call', () => {
      const a = generateTotpSecret();
      const b = generateTotpSecret();
      expect(a).toMatch(/^[A-Z2-7]{32}$/); // 20 bytes → 32 chars base32
      expect(a).not.toBe(b);
    });
  });

  describe('buildOtpAuthUri', () => {
    it('should build a standard Key Uri Format URI', () => {
      const uri = buildOtpAuthUri('ABC234', 'rafael@gdr.com.br');
      expect(uri).toContain('otpauth://totp/Avequi%20ERP:rafael%40gdr.com.br');
      expect(uri).toContain('secret=ABC234');
      expect(uri).toContain('issuer=Avequi+ERP');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });
  });
});
