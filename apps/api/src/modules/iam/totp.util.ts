import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * TOTP — RFC 6238 (sobre HOTP, RFC 4226) implementado com crypto NATIVO.
 *
 * DECISÃO (#344): implementação própria em vez de `otplib`. Motivos:
 * 1. O algoritmo inteiro cabe em ~60 linhas auditáveis (HMAC-SHA1 + truncação
 *    dinâmica) — menos superfície que uma dependência transitiva de terceiro
 *    num caminho crítico de autenticação;
 * 2. Zero dependência nova no package.json (política do projeto: menos deps);
 * 3. Compatibilidade garantida com Google Authenticator/Authy/1Password via
 *    os parâmetros default de mercado: SHA-1, 6 dígitos, step de 30s;
 * 4. Testado contra os vetores oficiais do Appendix B da RFC 6238 (ver
 *    totp.util.spec.ts).
 */

/** Passo de tempo do TOTP (RFC 6238 default — 30 segundos). */
export const TOTP_STEP_SECONDS = 30;
/** Dígitos do código (default de mercado — 6). */
export const TOTP_DIGITS = 6;
/** Janela de tolerância: aceita o step atual ±1 (clock skew de até 30s). */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica bytes em base32 (RFC 4648, sem padding — formato dos apps TOTP). */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** Decodifica base32 (case-insensitive, ignora padding/espaços). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Caractere base32 inválido: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Gera um secret TOTP novo: 20 bytes aleatórios (160 bits, RFC 4226 §4) em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226): HMAC-SHA1 do contador + truncação dinâmica → N dígitos. */
function hotp(secret: Buffer, counter: number, digits: number): string {
  const buf = Buffer.alloc(8);
  // Contador de 64 bits big-endian (só os 48 bits baixos importam até ~8921556)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

/** Código TOTP do instante `timestampMs` (default: agora). */
export function totpCode(
  secretBase32: string,
  timestampMs: number = Date.now(),
  stepSeconds: number = TOTP_STEP_SECONDS,
  digits: number = TOTP_DIGITS,
): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  return hotp(base32Decode(secretBase32), counter, digits);
}

/**
 * Verifica um código TOTP com janela ±`window` steps (default ±1 = tolera 30s
 * de clock skew entre o celular do usuário e o servidor). Comparação em tempo
 * constante (timingSafeEqual) para não vazar dígitos por timing.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  window: number = TOTP_WINDOW,
  timestampMs: number = Date.now(),
): boolean {
  const normalized = (code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS);
  const candidate = Buffer.from(normalized);
  let valid = false;
  // Percorre TODA a janela sempre (sem early-return) — tempo constante.
  for (let offset = -window; offset <= window; offset++) {
    const expected = Buffer.from(hotp(secret, counter + offset, TOTP_DIGITS));
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      valid = true;
    }
  }
  return valid;
}

/**
 * URI otpauth:// para o QR code (o frontend futuro renderiza; o Google
 * Authenticator/Authy escaneia). Formato padrão da Key Uri Format.
 */
export function buildOtpAuthUri(
  secretBase32: string,
  accountEmail: string,
  issuer = 'Avequi ERP',
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountEmail)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
