import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';

/**
 * Bloco F (#624): a gestão ampliada (respostas compartilhadas da loja +
 * pessoais de terceiros) deixou de ser decidida pelo enum legado
 * (STORE_MANAGER_ROLES) e passou à permissão complementar do IAM v2 —
 * checada via PermissionService (herança, perfis customizados, denies).
 */
const MANAGE_ALL_PERMISSION = 'crm.quick-replies.manage-all';

/** Atalho: minúsculo, sem espaço/acentos — o vendedor digita "/pix" no inbox */
const SHORTCUT_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

export interface QuickReplyInput {
  shortcut: string;
  text: string;
  /** STORE = compartilhada da loja (só gerente); PERSONAL = do vendedor */
  scope: 'STORE' | 'PERSONAL';
}

export interface RequestActor {
  id: string;
  companyId: string;
}

/**
 * F3.5-C3 (#553) — respostas rápidas (canned responses) do inbox. Atalhos p/ as
 * perguntas que o vendedor repete 50x/dia, DENTRO da janela 24h (custo zero).
 * ownerId null = escopo loja; preenchido = pessoal. A pessoal do vendedor tem
 * precedência sobre a da loja quando o atalho colide (regra aplicada no inbox,
 * que recebe a lista já ordenada: pessoais primeiro).
 */
@Injectable()
export class QuickReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionService,
  ) {}

  /** Respostas visíveis p/ o vendedor: pessoais dele + compartilhadas da loja */
  async list(actor: RequestActor) {
    return this.prisma.quickReply.findMany({
      where: {
        companyId: actor.companyId,
        OR: [{ ownerId: null }, { ownerId: actor.id }],
      },
      orderBy: [{ ownerId: { sort: 'desc', nulls: 'last' } }, { shortcut: 'asc' }],
      include: { owner: { select: { id: true, name: true } } },
    });
  }

  async create(actor: RequestActor, input: QuickReplyInput) {
    const shortcut = this.normalizeShortcut(input.shortcut);
    const text = input.text?.trim();
    if (!text) throw new BadRequestException('Texto da resposta é obrigatório');
    const ownerId = await this.resolveOwner(actor, input.scope);

    await this.assertShortcutFree(actor.companyId, ownerId, shortcut);
    return this.prisma.quickReply.create({
      data: { companyId: actor.companyId, shortcut, text, ownerId },
    });
  }

  async update(actor: RequestActor, id: string, input: Partial<QuickReplyInput>) {
    const existing = await this.findOwned(actor, id);

    const data: { shortcut?: string; text?: string } = {};
    if (input.shortcut != null) {
      data.shortcut = this.normalizeShortcut(input.shortcut);
      if (data.shortcut !== existing.shortcut) {
        await this.assertShortcutFree(actor.companyId, existing.ownerId, data.shortcut, id);
      }
    }
    if (input.text != null) {
      const text = input.text.trim();
      if (!text) throw new BadRequestException('Texto da resposta é obrigatório');
      data.text = text;
    }
    return this.prisma.quickReply.update({ where: { id }, data });
  }

  async remove(actor: RequestActor, id: string) {
    await this.findOwned(actor, id);
    await this.prisma.quickReply.delete({ where: { id } });
    return { deleted: true };
  }

  // ── internos ────────────────────────────────────────────────────────────────

  /** Gestão ampliada via IAM v2 — nunca pelo enum legado (Bloco F #624) */
  private canManageAll(actor: RequestActor): Promise<boolean> {
    return this.permissions.hasPermission(actor.id, actor.companyId, MANAGE_ALL_PERMISSION);
  }

  /** Carrega e valida: pessoal só pelo dono; da loja/de terceiro exige manage-all */
  private async findOwned(actor: RequestActor, id: string) {
    const reply = await this.prisma.quickReply.findFirst({
      where: { id, companyId: actor.companyId },
    });
    if (!reply) throw new NotFoundException('Resposta rápida não encontrada');
    if (reply.ownerId == null) {
      if (!(await this.canManageAll(actor))) {
        throw new ForbiddenException('Só a gestão altera respostas da loja');
      }
    } else if (reply.ownerId !== actor.id && !(await this.canManageAll(actor))) {
      throw new ForbiddenException('Resposta pessoal de outro vendedor');
    }
    return reply;
  }

  private async resolveOwner(
    actor: RequestActor,
    scope: 'STORE' | 'PERSONAL',
  ): Promise<string | null> {
    if (scope === 'STORE') {
      if (!(await this.canManageAll(actor))) {
        throw new ForbiddenException('Só a gestão cria respostas da loja');
      }
      return null;
    }
    return actor.id;
  }

  private normalizeShortcut(raw: string): string {
    const shortcut = raw?.trim().replace(/^\//, '').toLowerCase() ?? '';
    if (!SHORTCUT_RE.test(shortcut)) {
      throw new BadRequestException(
        'Atalho inválido: use letras minúsculas, números, "-" ou "_" (até 30 caracteres)',
      );
    }
    return shortcut;
  }

  /**
   * Unicidade por escopo, validada em código: Postgres trata NULLs como
   * distintos, então a constraint não cobre as respostas da loja (ownerId null).
   */
  private async assertShortcutFree(
    companyId: string,
    ownerId: string | null,
    shortcut: string,
    ignoreId?: string,
  ): Promise<void> {
    const clash = await this.prisma.quickReply.findFirst({
      where: { companyId, ownerId, shortcut, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
    });
    if (clash) throw new ConflictException(`Já existe "/${shortcut}" neste escopo`);
  }
}
