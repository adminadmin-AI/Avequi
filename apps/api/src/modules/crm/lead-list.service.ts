import { BadRequestException, Injectable } from '@nestjs/common';
import { LostReasonCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CrmService } from './crm.service';
import { LeadIntakeService } from './lead-intake.service';

export interface LeadListFilters {
  source?: string;
  stageId?: string;
  assignedToId?: string;
  /** ISO date (YYYY-MM-DD) — janela de criação do lead */
  from?: string;
  to?: string;
  /** busca em nome/telefone/email/interesse */
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'name' | 'lastInteractionAt' | 'estimatedValue';
  sortDir?: 'asc' | 'desc';
}

const SORTABLE: LeadListFilters['sortBy'][] = [
  'createdAt',
  'name',
  'lastInteractionAt',
  'estimatedValue',
];

/**
 * F3.5-C7 (#557) — lista de leads em tabela (a visão que o kanban não dá):
 * filtros combináveis, export CSV e ações em lote. As ações em lote REUSAM
 * os serviços unitários (reassign/changeStage) — mesmas regras e eventos.
 */
@Injectable()
export class LeadListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly leadIntake: LeadIntakeService,
  ) {}

  async list(companyId: string, filters: LeadListFilters) {
    const where = this.buildWhere(companyId, filters);
    const page = Math.max(filters.page ?? 1, 1);
    const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
    const sortBy = SORTABLE.includes(filters.sortBy) ? filters.sortBy! : 'createdAt';
    const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc';

    const [total, items] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          source: true,
          interest: true,
          estimatedValue: true,
          lostReason: true,
          createdAt: true,
          lastInteractionAt: true,
          stage: { select: { id: true, name: true, type: true, color: true } },
          assignedTo: { select: { id: true, name: true } },
          salesOrderId: true,
        },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Export CSV com os MESMOS filtros da lista (teto de 5000 linhas) */
  async csv(companyId: string, filters: LeadListFilters): Promise<string> {
    const where = this.buildWhere(companyId, filters);
    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      select: {
        name: true,
        phone: true,
        email: true,
        source: true,
        interest: true,
        estimatedValue: true,
        lostReason: true,
        createdAt: true,
        lastInteractionAt: true,
        stage: { select: { name: true } },
        assignedTo: { select: { name: true } },
      },
    });

    const esc = (v: unknown): string => {
      if (v == null) return '';
      const s = String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = 'nome;telefone;email;origem;interesse;valor_estimado;estagio;vendedor;motivo_perda;criado_em;ultima_interacao';
    const rows = leads.map((l) =>
      [
        esc(l.name),
        esc(l.phone),
        esc(l.email),
        esc(l.source),
        esc(l.interest),
        esc(l.estimatedValue?.toString()),
        esc(l.stage?.name),
        esc(l.assignedTo?.name),
        esc(l.lostReason),
        l.createdAt.toISOString(),
        l.lastInteractionAt?.toISOString() ?? '',
      ].join(';'),
    );
    return [header, ...rows].join('\n');
  }

  // ── Ações em lote ───────────────────────────────────────────────────────────

  /** Reatribui em lote (gerente). Falha individual não interrompe o lote. */
  async bulkReassign(companyId: string, leadIds: string[], toUserId: string, actorId: string) {
    this.assertBatch(leadIds);
    const results = [];
    for (const leadId of leadIds) {
      try {
        await this.leadIntake.reassign(companyId, leadId, toUserId, actorId);
        results.push({ leadId, ok: true });
      } catch (err) {
        results.push({ leadId, ok: false, error: (err as Error).message });
      }
    }
    return this.summarize(results);
  }

  /** Muda estágio em lote — mesmas regras do unitário (Perdido exige motivo) */
  async bulkChangeStage(
    companyId: string,
    leadIds: string[],
    stageId: string,
    actorId: string,
    lostReason?: string,
    lostReasonCategory?: LostReasonCategory,
  ) {
    this.assertBatch(leadIds);
    const results = [];
    for (const leadId of leadIds) {
      try {
        await this.crm.changeStage(companyId, leadId, stageId, actorId, lostReason, lostReasonCategory);
        results.push({ leadId, ok: true });
      } catch (err) {
        results.push({ leadId, ok: false, error: (err as Error).message });
      }
    }
    return this.summarize(results);
  }

  // ── internos ────────────────────────────────────────────────────────────────

  private buildWhere(companyId: string, f: LeadListFilters): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = { companyId };
    if (f.source) where.source = f.source as any;
    if (f.stageId) where.stageId = f.stageId;
    if (f.assignedToId) where.assignedToId = f.assignedToId;
    if (f.from || f.to) {
      where.createdAt = {};
      if (f.from) (where.createdAt as any).gte = new Date(f.from);
      if (f.to) {
        const to = new Date(f.to);
        to.setHours(23, 59, 59, 999); // "até" inclui o dia inteiro
        (where.createdAt as any).lte = to;
      }
    }
    if (f.search?.trim()) {
      const q = f.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q.replace(/\D/g, '') || q } },
        { email: { contains: q, mode: 'insensitive' } },
        { interest: { contains: q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private assertBatch(leadIds: string[]): void {
    if (!leadIds?.length) throw new BadRequestException('Selecione ao menos um lead');
    if (leadIds.length > 200) throw new BadRequestException('Máximo de 200 leads por lote');
  }

  private summarize(results: Array<{ leadId: string; ok: boolean; error?: string }>) {
    return {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }
}
