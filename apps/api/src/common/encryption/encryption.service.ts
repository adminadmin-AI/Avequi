import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * EncryptionService — criptografia simétrica genérica AES-256-GCM (#344).
 *
 * HISTÓRICO: o CLAUDE.md dizia que este serviço existia ("BankAccount
 * credentials com AES-256-GCM") mas era documentação à frente do código
 * (gap G11 da arquitetura IAM v2). Este arquivo o cria de verdade — o
 * primeiro consumidor é o MFA (#344), que criptografa o secret TOTP em
 * repouso. O futuro serviço bancário pode reutilizar este serviço (com a
 * mesma ENCRYPTION_KEY ou uma chave própria — decisão futura).
 *
 * ── Chave ────────────────────────────────────────────────────────────────
 * Env `ENCRYPTION_KEY`: 64 caracteres hex (= 32 bytes = AES-256). Gere com:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * A env é OPTIONAL no Joi (src/app.module.ts) porque "required em produção
 * SE MFA estiver em uso" não é expressável em validação de boot — quem
 * nunca habilita MFA não precisa da chave. Em compensação o serviço é
 * FAIL-FAST em runtime:
 *   - chave presente mas MALFORMADA → lança NA CONSTRUÇÃO (derruba o boot);
 *   - chave ausente → boot segue com warning; qualquer encrypt()/decrypt()
 *     lança erro claro (o MfaService traduz para 503 "MFA indisponível").
 *
 * ── Formato do ciphertext ────────────────────────────────────────────────
 * `v1:<iv hex>:<authTag hex>:<ciphertext hex>` — IV aleatório de 12 bytes
 * por operação (NUNCA reutilizado) + auth tag GCM de 16 bytes (detecção de
 * adulteração). O prefixo `v1` permite rotação de esquema no futuro.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer | null;

  /** Tamanho do IV do GCM (12 bytes é o recomendado pelo NIST SP 800-38D). */
  private static readonly IV_LENGTH = 12;
  private static readonly VERSION = 'v1';
  private static readonly KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

  constructor(config: ConfigService) {
    const raw = config.get<string>('ENCRYPTION_KEY');
    if (!raw) {
      this.key = null;
      this.logger.warn(
        'ENCRYPTION_KEY não configurada — criptografia em repouso indisponível ' +
          '(MFA não poderá ser habilitado até configurar a chave).',
      );
      return;
    }
    // Fail-fast NO BOOT: chave presente mas inválida é erro de configuração,
    // não pode passar silenciosamente (dados seriam gravados com chave errada).
    if (!EncryptionService.KEY_PATTERN.test(raw)) {
      throw new Error(
        'ENCRYPTION_KEY inválida: precisa ter exatamente 64 caracteres hexadecimais (32 bytes).',
      );
    }
    this.key = Buffer.from(raw, 'hex');
  }

  /** A chave está configurada? (consultado pelo MfaService para 503 amigável) */
  isConfigured(): boolean {
    return this.key !== null;
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error(
        'ENCRYPTION_KEY não configurada — impossível criptografar/descriptografar. ' +
          'Defina a env ENCRYPTION_KEY (64 hex chars) antes de usar MFA.',
      );
    }
    return this.key;
  }

  /** Criptografa texto UTF-8 → `v1:<iv>:<tag>:<ct>` (hex). */
  encrypt(plaintext: string): string {
    const key = this.requireKey();
    const iv = randomBytes(EncryptionService.IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      EncryptionService.VERSION,
      iv.toString('hex'),
      tag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  /**
   * Descriptografa `v1:<iv>:<tag>:<ct>`. Lança em caso de formato inválido,
   * chave errada ou ADULTERAÇÃO (auth tag do GCM não confere).
   */
  decrypt(payload: string): string {
    const key = this.requireKey();
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== EncryptionService.VERSION) {
      throw new Error('Payload criptografado em formato inválido');
    }
    const [, ivHex, tagHex, ctHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctHex, 'hex')),
      decipher.final(), // lança se a auth tag não conferir (tamper detection)
    ]);
    return plaintext.toString('utf8');
  }
}
