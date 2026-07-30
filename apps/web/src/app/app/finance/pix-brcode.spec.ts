import { describe, it, expect } from 'vitest';
import { extractPixKeyFromBrCode } from './pix-brcode';

/** Monta um campo TLV: id + tamanho (2 dígitos) + valor. */
const tlv = (id: string, value: string) =>
  `${id}${String(value.length).padStart(2, '0')}${value}`;

/** BR Code estático mínimo com a chave no campo 26. */
function brCode(key: string, guiId = '26', gui = 'br.gov.bcb.pix') {
  const mai = tlv('00', gui) + tlv('01', key);
  return (
    tlv('00', '01') + // payload format
    tlv(guiId, mai) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('58', 'BR') +
    tlv('59', 'GDR REBOQUES') +
    tlv('60', 'CASCAVEL') +
    tlv('62', tlv('05', '***')) +
    tlv('63', 'ABCD') // CRC (não validamos)
  );
}

describe('extractPixKeyFromBrCode', () => {
  it('extrai chave e-mail, CNPJ e EVP de BR Codes válidos', () => {
    expect(extractPixKeyFromBrCode(brCode('financeiro@gdr.com.br'))).toBe(
      'financeiro@gdr.com.br',
    );
    expect(extractPixKeyFromBrCode(brCode('12345678000199'))).toBe('12345678000199');
    expect(extractPixKeyFromBrCode(brCode('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))).toBe(
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    );
  });

  it('aceita a chave em qualquer id da faixa 26–51', () => {
    expect(extractPixKeyFromBrCode(brCode('chave@x.com', '51'))).toBe('chave@x.com');
  });

  it('GUI diferente de br.gov.bcb.pix → null (não é PIX)', () => {
    expect(extractPixKeyFromBrCode(brCode('chave@x.com', '26', 'com.outra.coisa'))).toBeNull();
  });

  it('QR dinâmico sem subcampo 01 (só URL do PSP) → null', () => {
    const mai = tlv('00', 'br.gov.bcb.pix') + tlv('25', 'pix.psp.com/qr/abc123');
    const code = tlv('00', '01') + tlv('26', mai) + tlv('63', 'ABCD');
    expect(extractPixKeyFromBrCode(code)).toBeNull();
  });

  it('texto que não é BR Code → null (chave solta, lixo, vazio)', () => {
    expect(extractPixKeyFromBrCode('financeiro@gdr.com.br')).toBeNull();
    expect(extractPixKeyFromBrCode('00020!corrompido')).toBeNull();
    expect(extractPixKeyFromBrCode('0002019999')).toBeNull(); // TLV não fecha
    expect(extractPixKeyFromBrCode('')).toBeNull();
    expect(extractPixKeyFromBrCode(null)).toBeNull();
    expect(extractPixKeyFromBrCode(undefined)).toBeNull();
  });
});
