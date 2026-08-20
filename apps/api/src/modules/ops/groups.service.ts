import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { SessionService } from '../iam/session.service';
import { AddCompanyToGroupDto, CreateCompanyGroupDto } from './dto/company-group.dto';
import { OpsActionContext } from './ops.service';

/**
 * GroupsService — GRUPO ECONÔMICO (#1119), lado ESCRITA. Control plane.
 *
 * ⚠️ FRONTEIRA CROSS-TENANT: como o resto de `modules/ops/**`, este service
 * enxerga empresas sem filtro de companyId do JWT. Toda rota que chega aqui
 * passou por @RequirePermission('ops.groups.*') + OpsMfaGuard + OpsSessionGuard.
 *
 * ── Por que a operadora, e não o cliente ──────────────────────────────────
 * Declarar que GDR e CRD são o mesmo grupo é declarar que uma pessoa da GDR
 * PODE receber acesso à CRD. Se o admin do tenant pudesse fazer isso, ele se
 * auto-concederia acesso a outro cliente — que é exatamente o buraco que o
 * isolamento multi-tenant existe para fechar. O laço nasce aqui, por chamado;
 * o admin do cliente só administra pessoas DENTRO de um grupo já declarado
 * (modules/iam/user-access.service.ts).
 *
 * ── Invariantes ───────────────────────────────────────────────────────────
 *  1. Só empresa RAIZ (`parentId === null`) entra em grupo — filial pertence
 *     ao grupo da matriz, e deixá-la entrar sozinha criaria dois grupos para
 *     o mesmo tenant.
 *  2. Uma empresa em NO MÁXIMO um grupo (a coluna é escalar; a checagem aqui
 *     é para dar erro legível em vez de troca silenciosa de grupo).
 *  3. Desassociar LIMPA o que o grupo autorizava: vínculos cruzados de perfil
 *     e sessões de visitantes na empresa que saiu. Sem isso, sobraria acesso
 *     órfão a um grupo que não existe mais.
 */
@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly sessionService: SessionService,
  ) {}

  private readonly COMPANY_SELECT = {
    id: true,
    name: true,
    razaoSocial: true,
    cnpj: true,
    tenantStatus: true,
  } as const;

  /** Lista os grupos com suas empresas. */
  async list() {
    return this.prisma.companyGroup.findMany({
      include: { companies: { select: this.COMPANY_SELECT, orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const group = await this.prisma.companyGroup.findUnique({
      where: { id },
      include: { companies: { select: this.COMPANY_SELECT, orderBy: { name: 'asc' } } },
    });
    if (!group) throw new NotFoundException('Grupo não encontrado');
    return group;
  }

  async create(dto: CreateCompanyGroupDto, ctx: OpsActionContext) {
    const group = await this.prisma.companyGroup.create({
      data: { name: dto.name.trim() },
    });

    await this.auditService.persist({
      companyId: ctx.actorCompanyId,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'CompanyGroup',
      entityId: group.id,
      action: AuditAction.CREATE,
      module: 'ops',
      newValue: { name: group.name },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    return group;
  }

  /**
   * Associa um tenant ao grupo. Auditado nos DOIS lados: no grupo (contexto do
   * operador) e no tenant afetado — o admin do cliente precisa conseguir ver,
   * na trilha dele, o dia em que a empresa dele entrou num grupo.
   */
  async addCompany(groupId: string, dto: AddCompanyToGroupDto, ctx: OpsActionContext) {
    const group = await this.prisma.companyGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new NotFoundException('Grupo não encontrado');

    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
      select: { id: true, name: true, parentId: true, groupId: true },
    });
    if (!company) throw new NotFoundException('Empresa não encontrada');

    if (company.parentId !== null) {
      throw new BadRequestException(
        'Só a empresa matriz entra em grupo econômico — a filial acompanha a matriz.',
      );
    }
    if (company.groupId === groupId) {
      throw new ConflictException('A empresa já pertence a este grupo.');
    }
    if (company.groupId) {
      throw new ConflictException(
        'A empresa já pertence a outro grupo econômico. Desassocie primeiro.',
      );
    }

    const updated = await this.prisma.company.update({
      where: { id: company.id },
      data: { groupId },
      select: this.COMPANY_SELECT,
    });

    await this.auditService.persist({
      companyId: company.id,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'Company',
      entityId: company.id,
      action: AuditAction.UPDATE,
      module: 'ops',
      oldValue: { groupId: null },
      newValue: { groupId, groupName: group.name },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    this.logger.log(
      JSON.stringify({
        event: 'ops_group_company_added',
        groupId,
        companyId: company.id,
        by: ctx.userId,
      }),
    );

    return updated;
  }

  /**
   * Desassocia o tenant do grupo e DERRUBA o que o grupo autorizava.
   *
   * Ordem deliberada: trilha primeiro, efeitos depois — se a limpeza falhar no
   * meio, a decisão já está registrada. E a limpeza é dos dois lados: quem
   * entrava na empresa que saiu, e quem saía dela para as demais do grupo.
   */
  async removeCompany(groupId: string, companyId: string, ctx: OpsActionContext) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, name: true, groupId: true },
    });
    if (!company || company.groupId !== groupId) {
      throw new NotFoundException('Empresa não pertence a este grupo');
    }

    // Empresas que continuam no grupo — o "outro lado" dos vínculos cruzados.
    const remanescentes = (
      await this.prisma.company.findMany({
        where: { groupId, id: { not: companyId } },
        select: { id: true },
      })
    ).map((c) => c.id);

    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { groupId: null },
      select: this.COMPANY_SELECT,
    });

    await this.auditService.persist({
      companyId: company.id,
      userId: ctx.userId,
      sessionId: ctx.sessionId ?? null,
      entity: 'Company',
      entityId: company.id,
      action: AuditAction.UPDATE,
      module: 'ops',
      oldValue: { groupId },
      newValue: { groupId: null },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const vinculos = await this.limparVinculosCruzados(companyId, remanescentes);
    const sessoes = await this.revogarSessoesCruzadas(companyId, remanescentes);

    this.logger.log(
      JSON.stringify({
        event: 'ops_group_company_removed',
        groupId,
        companyId,
        vinculosRemovidos: vinculos,
        sessoesRevogadas: sessoes,
        by: ctx.userId,
      }),
    );

    return { ...updated, vinculosRemovidos: vinculos, sessoesRevogadas: sessoes };
  }

  /**
   * Remove os UserRoleAssignment que só existiam por causa do grupo: perfil
   * de visitante (usuário de outra empresa) na empresa que saiu, e perfil de
   * gente da empresa que saiu nas empresas que ficaram.
   *
   * O vínculo de quem é DA CASA nunca é tocado — ele não depende de grupo.
   */
  private async limparVinculosCruzados(
    companyId: string,
    remanescentes: string[],
  ): Promise<number> {
    // tenant-lint: ok (control plane: limpeza cross-tenant do grupo #1119)
    const visitantesNaQueSaiu = await this.prisma.userRoleAssignment.deleteMany({
      where: { companyId, user: { companyId: { not: companyId } } },
    });

    let daCasaNasQueFicaram = { count: 0 };
    if (remanescentes.length > 0) {
      // tenant-lint: ok (control plane: limpeza cross-tenant do grupo #1119)
      daCasaNasQueFicaram = await this.prisma.userRoleAssignment.deleteMany({
        where: { companyId: { in: remanescentes }, user: { companyId } },
      });
    }

    return visitantesNaQueSaiu.count + daCasaNasQueFicaram.count;
  }

  /** Derruba as sessões que estavam abertas sob a autorização do grupo. */
  private async revogarSessoesCruzadas(
    companyId: string,
    remanescentes: string[],
  ): Promise<number> {
    let total = await this.sessionService.revokeSessionsInCompany(companyId, {
      exceptUserIdsOfCompany: true,
    });

    for (const outra of remanescentes) {
      const sessoes = await this.prisma.userSession.findMany({
        where: { companyId: outra, revokedAt: null, user: { companyId } },
        select: { userId: true },
        distinct: ['userId'],
      });
      for (const s of sessoes) {
        total += await this.sessionService.revokeSessionsInCompany(outra, {
          userId: s.userId,
        });
      }
    }

    return total;
  }
}
