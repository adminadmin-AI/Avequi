import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SecurityEventSeverity, SecurityEventType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { PrismaService } from '../../prisma/prisma.service';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from './totp.util';

/**
 * MfaService — MFA/2FA com TOTP e backup codes (issue #344, Fase F4.1).
 *
 * Implementa o Bloco D da arquitetura (docs/iam/ARQUITETURA-IAM-V2.md):
 *
 * ── Setup em dois tempos ─────────────────────────────────────────────────
 * 1. `setup()` gera o secret + otpauth:// URI (QR no frontend futuro) e grava
 *    a linha UserMFA com enabled=false — o MFA ainda NÃO vale;
 * 2. `confirm(código)` prova que o app autenticador foi configurado → aí sim
 *    enabled=true + 10 backup codes (mostrados UMA vez, guardados como hash
 *    bcrypt, uso único) + SecurityEvent(MFA_ENABLED) síncrono (Decisão 5).
 *
 * ── Segurança do secret ──────────────────────────────────────────────────
 * O secret TOTP é criptografado em repouso (AES-256-GCM, EncryptionService).
 * Sem ENCRYPTION_KEY configurada, setup/verify respondem 503 com mensagem
 * clara — fail-fast em runtime, já que o Joi não pode exigir a chave só
 * "quando MFA estiver em uso".
 *
 * ── Enforcement por perfil (SUAVE) ───────────────────────────────────────
 * Role.requireMfa=true + usuário sem MFA → o login responde
 * `mfaSetupRequired: true` mas NÃO bloqueia. O enforcement DURO (bloquear
 * após grace period, como a issue #344 sugere) é decisão pendente do Rafael.
 *
 * ── FORA DO ESCOPO deste PR — RESET DE MFA POR ADMIN (fase futura) ────────
 * NÃO existe reset de MFA por administrador neste PR. Hoje o usuário se
 * recupera sozinho com um backup code. Quando alguém perder o celular E os
 * backup codes, será necessário um reset administrativo. Requisito (decisão
 * Rafael, #467): restrito a SUPER_ADMIN/conta principal e AUDITÁVEL
 * (SecurityEvent). Fica para uma fase futura, junto da tela de administração
 * de usuários (#352). Rastreado em issue própria.
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  /** Quantidade de backup codes gerados no confirm/regenerate. */
  static readonly BACKUP_CODES_COUNT = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private assertEncryptionAvailable(): void {
    if (!this.encryption.isConfigured()) {
      throw new ServiceUnavailableException(
        'MFA indisponível: a env ENCRYPTION_KEY não está configurada no servidor.',
      );
    }
  }

  /** Formato dos backup codes: XXXX-XXXX (hex, fácil de anotar no papel). */
  private generateBackupCodes(): string[] {
    return Array.from({ length: MfaService.BACKUP_CODES_COUNT }, () => {
      const raw = randomBytes(4).toString('hex');
      return `${raw.slice(0, 4)}-${raw.slice(4)}`;
    });
  }

  private hashBackupCodes(codes: string[]): string[] {
    return codes.map((code) => bcrypt.hashSync(this.normalizeBackupCode(code), 10));
  }

  private normalizeBackupCode(code: string): string {
    return code.trim().toLowerCase().replace(/\s/g, '');
  }

  /** MFA está habilitado (setup CONFIRMADO) para o usuário? */
  async isEnabled(userId: string): Promise<boolean> {
    const row = await this.prisma.userMFA.findUnique({
      where: { userId },
      select: { enabled: true },
    });
    return row?.enabled === true;
  }

  /**
   * Enforcement suave: algum perfil (Role RBAC do #462) do usuário exige MFA?
   * Considera apenas atribuições vigentes (não expiradas) de perfis ativos.
   * Best-effort: erro de banco → false (não pode derrubar o login).
   */
  async roleRequiresMfa(userId: string): Promise<boolean> {
    try {
      const count = await this.prisma.userRoleAssignment.count({
        where: {
          userId,
          role: { requireMfa: true, isActive: true },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      return count > 0;
    } catch (err) {
      this.logger.warn(
        `Falha ao consultar requireMfa (best-effort, assume false): ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Passo 1 do setup: gera secret novo + otpauth:// URI. O MFA continua
   * DESABILITADO até o confirm. Chamar de novo antes do confirm regenera o
   * secret (o anterior nunca foi confirmado — descartável por definição).
   */
  async setup(user: { id: string; email: string }): Promise<{ secret: string; otpauthUri: string }> {
    this.assertEncryptionAvailable();

    const existing = await this.prisma.userMFA.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (existing?.enabled) {
      throw new ConflictException(
        'MFA já está habilitado. Para trocar de app autenticador, desabilite e configure de novo.',
      );
    }

    const secret = generateTotpSecret();
    const encrypted = this.encryption.encrypt(secret);

    await this.prisma.userMFA.upsert({
      where: { userId: user.id },
      create: { userId: user.id, secret: encrypted, enabled: false, backupCodes: [] },
      update: { secret: encrypted, enabled: false, verifiedAt: null, backupCodes: [] },
    });

    return { secret, otpauthUri: buildOtpAuthUri(secret, user.email) };
  }

  /**
   * Passo 2 do setup: usuário digita o código do app → prova que escaneou o
   * QR. Só então enabled=true + backup codes (mostrados UMA ÚNICA vez aqui;
   * no banco ficam apenas os hashes bcrypt).
   */
  async confirm(
    user: { id: string; companyId: string },
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    this.assertEncryptionAvailable();

    const row = await this.prisma.userMFA.findUnique({ where: { userId: user.id } });
    if (!row) {
      throw new BadRequestException('Setup de MFA não iniciado. Chame POST /auth/mfa/setup antes.');
    }
    if (row.enabled) {
      throw new ConflictException('MFA já está habilitado.');
    }

    const secret = this.encryption.decrypt(row.secret);
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException('Código TOTP inválido.');
    }

    const backupCodes = this.generateBackupCodes();

    // Decisão 5: evento de segurança grava na MESMA transação da ação.
    await this.prisma.$transaction([
      this.prisma.userMFA.update({
        where: { userId: user.id },
        data: {
          enabled: true,
          verifiedAt: new Date(),
          backupCodes: this.hashBackupCodes(backupCodes),
        },
      }),
      this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          eventType: SecurityEventType.MFA_ENABLED,
          severity: SecurityEventSeverity.INFO,
          metadata: { backupCodesGenerated: backupCodes.length },
        },
      }),
    ]);

    return { backupCodes };
  }

  /**
   * Verifica um código no LOGIN (2º passo) e em operações sensíveis:
   * 1º tenta TOTP (janela ±1 step); 2º tenta backup codes (bcrypt.compare) —
   * backup code válido é CONSUMIDO (removido do array — uso único).
   * Retorna false para qualquer código inválido (quem chama decide o 401).
   */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    this.assertEncryptionAvailable();

    const row = await this.prisma.userMFA.findUnique({ where: { userId } });
    if (!row?.enabled) return false;

    const secret = this.encryption.decrypt(row.secret);
    if (verifyTotp(secret, code)) return true;

    // Backup code? (uso único: remove o hash consumido)
    const normalized = this.normalizeBackupCode(code);
    if (!normalized) return false;
    for (let i = 0; i < row.backupCodes.length; i++) {
      if (bcrypt.compareSync(normalized, row.backupCodes[i])) {
        const remaining = row.backupCodes.filter((_, idx) => idx !== i);
        await this.prisma.userMFA.update({
          where: { userId },
          data: { backupCodes: remaining },
        });
        this.logger.warn(
          `Backup code de MFA consumido pelo usuário ${userId} (${remaining.length} restantes).`,
        );
        return true;
      }
    }
    return false;
  }

  /**
   * Desabilita o MFA — exige SENHA + código válido (TOTP ou backup code):
   * um atacante com a sessão roubada não consegue remover o segundo fator.
   */
  async disable(
    user: { id: string; companyId: string },
    password: string,
    code: string,
  ): Promise<void> {
    this.assertEncryptionAvailable();

    if (!(await this.isEnabled(user.id))) {
      throw new BadRequestException('MFA não está habilitado.');
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!dbUser || !(await bcrypt.compare(password ?? '', dbUser.passwordHash))) {
      throw new UnauthorizedException('Senha inválida.');
    }

    if (!(await this.verifyCode(user.id, code))) {
      throw new UnauthorizedException('Código MFA inválido.');
    }

    // Decisão 5: SecurityEvent síncrono na mesma transação.
    await this.prisma.$transaction([
      this.prisma.userMFA.delete({ where: { userId: user.id } }),
      this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          eventType: SecurityEventType.MFA_DISABLED,
          severity: SecurityEventSeverity.WARNING,
          metadata: {},
        },
      }),
    ]);
  }

  /**
   * Regenera os 10 backup codes (exige código MFA válido). Os antigos são
   * invalidados; os novos são mostrados UMA vez.
   */
  async regenerateBackupCodes(
    user: { id: string; companyId: string },
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    this.assertEncryptionAvailable();

    if (!(await this.isEnabled(user.id))) {
      throw new BadRequestException('MFA não está habilitado.');
    }
    if (!(await this.verifyCode(user.id, code))) {
      throw new UnauthorizedException('Código MFA inválido.');
    }

    const backupCodes = this.generateBackupCodes();
    await this.prisma.$transaction([
      this.prisma.userMFA.update({
        where: { userId: user.id },
        data: { backupCodes: this.hashBackupCodes(backupCodes) },
      }),
      this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          eventType: SecurityEventType.MFA_BACKUP_CODES_REGENERATED,
          severity: SecurityEventSeverity.INFO,
          metadata: { count: backupCodes.length },
        },
      }),
    ]);

    return { backupCodes };
  }

  /**
   * SecurityEvent de verify FALHO no login (2º passo). Best-effort: trilha
   * de segurança não pode derrubar a resposta 401.
   */
  async recordFailedVerify(
    user: { id: string; companyId: string },
    ctx: { ipAddress?: string; userAgent?: string } = {},
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          eventType: SecurityEventType.LOGIN_FAILED,
          severity: SecurityEventSeverity.WARNING,
          metadata: { stage: 'mfa' },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao registrar SecurityEvent de MFA (best-effort): ${(err as Error).message}`,
      );
    }
  }
}
