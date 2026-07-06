import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { EncryptionService } from './encryption.service';

/** ConfigService fake devolvendo a chave dada. */
function configWith(key?: string): ConfigService {
  return { get: jest.fn().mockReturnValue(key) } as unknown as ConfigService;
}

const VALID_KEY = randomBytes(32).toString('hex');

describe('EncryptionService (#344)', () => {
  it('should round-trip encrypt → decrypt', () => {
    const service = new EncryptionService(configWith(VALID_KEY));
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    const encrypted = service.encrypt(secret);

    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(service.decrypt(encrypted)).toBe(secret);
  });

  it('should produce DIFFERENT ciphertexts for the same plaintext (IV aleatório)', () => {
    const service = new EncryptionService(configWith(VALID_KEY));
    const a = service.encrypt('mesmo-texto');
    const b = service.encrypt('mesmo-texto');
    expect(a).not.toBe(b);
    expect(service.decrypt(a)).toBe('mesmo-texto');
    expect(service.decrypt(b)).toBe('mesmo-texto');
  });

  it('should detect tampering (auth tag GCM)', () => {
    const service = new EncryptionService(configWith(VALID_KEY));
    const encrypted = service.encrypt('dados-sensiveis');
    const [v, iv, tag, ct] = encrypted.split(':');
    // flipa o primeiro byte do ciphertext
    const flipped = (parseInt(ct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0');
    const tampered = [v, iv, tag, flipped + ct.slice(2)].join(':');

    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('should fail to decrypt with a different key', () => {
    const a = new EncryptionService(configWith(VALID_KEY));
    const b = new EncryptionService(configWith(randomBytes(32).toString('hex')));
    const encrypted = a.encrypt('segredo');
    expect(() => b.decrypt(encrypted)).toThrow();
  });

  it('should reject malformed payloads', () => {
    const service = new EncryptionService(configWith(VALID_KEY));
    expect(() => service.decrypt('nao-e-um-payload')).toThrow('formato inválido');
    expect(() => service.decrypt('v2:aa:bb:cc')).toThrow('formato inválido');
  });

  it('should throw AT CONSTRUCTION when key is present but malformed (fail-fast no boot)', () => {
    expect(() => new EncryptionService(configWith('curta'))).toThrow('64 caracteres hexadecimais');
    expect(() => new EncryptionService(configWith('z'.repeat(64)))).toThrow(
      '64 caracteres hexadecimais',
    );
  });

  it('should boot WITHOUT key but throw clear error on encrypt/decrypt', () => {
    const service = new EncryptionService(configWith(undefined));
    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt('x')).toThrow('ENCRYPTION_KEY não configurada');
    expect(() => service.decrypt('v1:aa:bb:cc')).toThrow('ENCRYPTION_KEY não configurada');
  });

  it('isConfigured should be true with a valid key', () => {
    expect(new EncryptionService(configWith(VALID_KEY)).isConfigured()).toBe(true);
  });
});
