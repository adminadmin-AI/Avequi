import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { UserService } from '../user/user.service';

/**
 * TenantInviteService — OPS WP2 (#909): convite de primeiro acesso do admin
 * do tenant. NUNCA senha em texto no e-mail: o link leva um token de uso
 * único (sha256 no banco, 72h); o aceite define a senha do usuário.
 *
 * O usuário admin nasce via UserService.create (fonte única: política de
 * senha #345 + vínculo RBAC v2 #738) com uma senha ALEATÓRIA que ninguém
 * conhece e mustChangePassword=true — até o aceite, a conta é inutilizável.
 * O aceite troca a senha (política aplicada de novo) e zera o
 * mustChangePassword, deixando o login normal.
 */

export const INVITE_TTL_HOURS = 72;

export interface InviteResult {
  inviteId: string;
  userId: string;
  email: string;
  expiresAt: Date;
  emailSent: boolean;
  emailError?: string;
}

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Senha temporária aleatória que cumpre a política (#345) — nunca exibida. */
function randomCompliantPassword(): string {
  return `Tmp!${randomBytes(24).toString('base64url')}9a`;
}

@Injectable()
export class TenantInviteService {
  private readonly logger = new Logger(TenantInviteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly userService: UserService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cria (ou reaproveita) o admin do tenant e (re)envia o convite.
   * Idempotente: reconvite revoga o token anterior e emite um novo.
   * O usuário é criado na COMPANY DO TENANT (não na do operador) — este é o
   * único fluxo autorizado a criar usuário cross-tenant, e só via /ops.
   */
  async inviteAdmin(
    companyId: string,
    dto: { name: string; email: string },
    actorId: string,
  ): Promise<InviteResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, companyId: true },
    });

    let userId: string;
    if (existing) {
      // Reconvite só faz sentido para usuário DESTE tenant; e-mail já usado
      // em outro tenant é erro do operador, não caso de borda silencioso.
      if (existing.companyId !== companyId) {
        throw new BadRequestException(
          'Este e-mail já pertence a um usuário de outra conta',
        );
      }
      userId = existing.id;
    } else {
      const user = await this.userService.create(
        {
          name: dto.name,
          email: dto.email,
          password: randomCompliantPassword(),
          role: UserRole.SUPER_ADMIN, // espelha ADMIN_GLOBAL (perfil de TENANT)
          mustChangePassword: true,
        },
        companyId,
        actorId,
      );
      userId = user.id;
    }

    // Reenvio revoga qualquer convite pendente do usuário
    await this.prisma.tenantInvite.updateMany({
      where: { userId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600 * 1000);
    const invite = await this.prisma.tenantInvite.create({
      data: {
        companyId,
        userId,
        email: dto.email,
        tokenHash: hashInviteToken(token),
        expiresAt,
        createdById: actorId,
      },
    });

    const webUrl = this.config.get<string>('WEB_URL', 'https://app.avecchi.ai');
    const link = `${webUrl}/invite/accept?token=${token}`;
    const mail = await this.mailService.send({
      to: dto.email,
      subject: 'Avecchi — seu acesso de administrador',
      text:
        `Olá, ${dto.name}!\n\n` +
        `Sua conta de administrador na Avecchi está pronta. ` +
        `Defina sua senha de acesso pelo link abaixo (válido por ${INVITE_TTL_HOURS}h, uso único):\n\n` +
        `${link}\n\n` +
        `Se você não esperava este convite, ignore este e-mail.\n\n` +
        `— Equipe Avecchi`,
    });
    if (!mail.ok) {
      // Convite fica válido mesmo sem e-mail (SMTP pode estar fora): o
      // operador vê emailSent=false no wizard e reenvia depois.
      this.logger.warn(
        `Convite ${invite.id} criado mas e-mail falhou: ${mail.reason}`,
      );
    }

    return {
      inviteId: invite.id,
      userId,
      email: dto.email,
      expiresAt,
      emailSent: mail.ok,
      ...(mail.ok ? {} : { emailError: mail.reason }),
    };
  }

  /**
   * Aceite PÚBLICO do convite: valida token (hash, validade, uso único),
   * aplica a política de senha (#345) e destrava o usuário. Mensagem de erro
   * ÚNICA para token inexistente/expirado/usado/revogado — não revela qual.
   */
  async acceptInvite(token: string, password: string) {
    const invalid = () =>
      new BadRequestException(
        'Convite inválido ou expirado. Peça um novo convite ao suporte da Avecchi.',
      );

    const invite = await this.prisma.tenantInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (
      !invite ||
      invite.usedAt ||
      invite.revokedAt ||
      invite.expiresAt < new Date()
    ) {
      throw invalid();
    }

    this.passwordPolicy.validateComplexity(password, {
      email: invite.user.email,
      name: invite.user.name,
    });

    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    // Transação: marcar o convite usado e destravar o usuário são um ato só.
    await this.prisma.$transaction([
      this.prisma.tenantInvite.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: invite.user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          isActive: true,
        },
      }),
    ]);
    await this.passwordPolicy.recordPasswordChange(
      invite.user.id,
      null,
      passwordHash,
    );

    return { ok: true, email: invite.user.email };
  }
}
