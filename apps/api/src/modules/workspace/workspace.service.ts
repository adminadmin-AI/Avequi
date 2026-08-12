import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AlertSeverity,
  AlertType,
  FinancialEntryStatus,
  FinancialEntryType,
  InspectionStatus,
  ProductionOrderStatus,
  SalesOrderStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService, permissionMatches } from '../iam/permission.service';
import { ApprovalService } from '../approval/approval.service';
import { VehicleDocumentService } from '../vehicle-document/vehicle-document.service';
import { FunnelService } from '../crm/funnel.service';

/**
 * Workspace — BFF da Home por papel (F1 do épico Workspace Inteligente).
 *
 * Três agregadores cross-domínio, todos CURADOS POR PERMISSÃO NO SERVIDOR:
 * o conjunto efetivo do usuário (PermissionService, mesmo cache Redis do
 * PermissionGuard) decide quais consultas RODAM — um supervisor de produção
 * nunca recebe (nem dispara) uma consulta financeira; o payload já chega
 * limpo, o frontend não filtra nada.
 *
 * - insights: Resumo do Dia (Antonella V1) — motor de REGRAS determinísticas
 *   sobre o hub de alertas + consultas prospectivas. A V2 (LLM) trocará o
 *   miolo mantendo o contrato.
 * - tasks: Minha Mesa — inbox unificado e priorizado: aprovações na alçada,
 *   follow-ups de CRM, inspeções de qualidade, cobrança vencida, expedição
 *   parada (documento do veículo) e cliente aguardando (SLA de 1ª resposta).
 * - agenda: próximos 7 dias — vencimentos financeiros, términos de OP e
 *   lembretes, unificados de datas que já existem no schema.
 *
 * Por ser BFF, os CTAs devolvem `href` de rotas REAIS do apps/web
 * (nav-config.ts) — acoplamento deliberado e documentado.
 */

type AuthUserLite = { id: string; companyId: string; role: string };

export interface WorkspaceInsight {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'SUCCESS';
  message: string;
  count?: number;
  cta?: { label: string; href: string };
}

export interface WorkspaceTask {
  id: string;
  type:
    | 'approval'
    | 'crm-reminder'
    | 'quality-inspection'
    | 'overdue-receivable'
    | 'vehicle-docs-pending'
    | 'crm-sla';
  title: string;
  subtitle?: string;
  href: string;
  dueAt?: string;
  createdAt?: string;
  /** Prioridade para o inbox "Minha Mesa" ordenar e colorir. Dinheiro vencido
   *  e aprovações são crítico; inspeções, atenção; follow-ups, informação. */
  priority?: 'critical' | 'warning' | 'info';
  /**
   * Presente só quando a pendência pode ser CONCLUÍDA num clique direto do
   * widget (ex.: lembrete de CRM → PATCH /crm/reminders/:id/done). Aprovações
   * e inspeções NÃO têm — resolver ali seria mentira (só se resolvem na tela do
   * domínio). O front mostra o círculo de check apenas quando isto existe.
   */
  complete?: { url: string };
}

/**
 * Meu Dia — comparação temporal HONESTA (brief "Workspace Vivo", pt.7).
 *
 * `today` é o que aconteceu no dia corrente (fuso da operação, não do
 * container); `period` compara os últimos N dias com os N imediatamente
 * anteriores. `deltaPct` é NULL quando não há base de comparação (período
 * anterior zerado) — dividir por zero viraria "+∞%" ou um zero mentiroso.
 *
 * NÃO existe meta/streak aqui de propósito: metas moram no épico #867/#868 e
 * ainda não têm cadastro. Número inventado em ERP financeiro é linha vermelha.
 */
export interface MyDayDelta {
  current: number;
  previous: number;
  /** Variação % vs período anterior; null = sem base de comparação. */
  deltaPct: number | null;
}

export interface MyDaySummary {
  /** Dia corrente no fuso da operação (YYYY-MM-DD). */
  date: string;
  periodDays: number;
  today: {
    invoiced?: { amount: number; count: number };
    received?: { amount: number; count: number };
    produced?: { orders: number; qty: number };
  };
  period: {
    invoiced?: MyDayDelta;
    received?: MyDayDelta;
    produced?: MyDayDelta;
  };
}

/**
 * Série de faturamento — um ponto por dia (fuso da operação), somando o valor
 * das vendas com NF emitida naquele dia. Substitui o consumo do sales-cube na
 * Home, que agrupava por MÊS de criação do pedido e incluía rascunho e
 * cancelado no total (dois erros distintos: base errada e status errado).
 */
export interface RevenuePoint {
  /** YYYY-MM-DD no fuso da operação. */
  period: string;
  value: number;
}

export interface RevenueSeries {
  periodDays: number;
  total: number;
  series: RevenuePoint[];
}

export interface WorkspaceNote {
  id: string;
  text: string;
  color: string;
  /** Ordem no mural (menor primeiro); fixadas ignoram e vêm antes. */
  position: number;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgendaItem {
  id: string;
  date: string; // ISO yyyy-mm-dd
  kind: 'finance-due' | 'production-end' | 'crm-reminder';
  title: string;
  href: string;
  tone?: 'danger' | 'warning' | 'neutral';
  /** Valor estruturado (itens financeiros) — o rollup do calendário SOMA isto,
   *  nunca parseia o título. */
  amount?: number;
}

const SEVERITY_ORDER: Record<WorkspaceInsight['severity'], number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
  SUCCESS: 3,
};

/**
 * Rollup de alertas por tipo → um insight por tipo com CTA para a tela do
 * domínio. Cada tipo exige a permissão do DOMÍNIO (não basta ver alertas):
 * o alerta de estoque só vira insight para quem enxerga estoque.
 *
 * Tipos deliberadamente FORA: PRODUCTION_LATE e PAYABLE_DUE (viram regras
 * prospectivas próprias, mais ricas), CRM_REMINDER_DUE (vira pendência em
 * /tasks), MRP_RUN_DONE/CRM_SDR_HANDOFF/RENAVE_OP_FAILED/BIN_REGISTER_FAILED
 * (nicho — continuam em /app/alerts).
 */
const ALERT_ROLLUPS: Partial<
  Record<AlertType, { permission: string; href: string; label: string; message: (n: number) => string }>
> = {
  [AlertType.STOCK_MIN]: {
    permission: 'stock.balances.view',
    href: '/app/stock',
    label: 'Ir para Estoque',
    message: (n) => (n === 1 ? '1 item com estoque abaixo do mínimo' : `${n} itens com estoque abaixo do mínimo`),
  },
  [AlertType.NFE_REJECTED]: {
    permission: 'fiscal.documents.view',
    href: '/app/fiscal',
    label: 'Ver NF-e',
    message: (n) => (n === 1 ? '1 NF-e rejeitada pela SEFAZ' : `${n} NF-e rejeitadas pela SEFAZ`),
  },
  [AlertType.FOCUS_NFE_DOWN]: {
    permission: 'fiscal.documents.view',
    href: '/app/fiscal',
    label: 'Ver Fiscal',
    message: () => 'Integração Focus NFe indisponível',
  },
  [AlertType.MANIFEST_OVERDUE]: {
    permission: 'fiscal.manifestation.view',
    href: '/app/fiscal/compliance',
    label: 'Ver manifestações',
    message: (n) =>
      n === 1 ? '1 NF-e de entrada com manifestação vencida' : `${n} NF-e de entrada com manifestação vencida`,
  },
  [AlertType.MAINTENANCE_DUE]: {
    permission: 'maintenance.orders.view',
    href: '/app/maintenance',
    label: 'Ver manutenções',
    message: (n) => (n === 1 ? '1 manutenção vencendo' : `${n} manutenções vencendo`),
  },
  [AlertType.QC_INSPECTION_FAILED]: {
    permission: 'quality.inspections.view',
    href: '/app/quality',
    label: 'Ver Qualidade',
    message: (n) => (n === 1 ? '1 inspeção de qualidade reprovada' : `${n} inspeções de qualidade reprovadas`),
  },
  [AlertType.CRM_SLA_ESCALATION]: {
    permission: 'crm.leads.view',
    href: '/app/crm/sla',
    label: 'Ver SLA',
    message: (n) => (n === 1 ? '1 lead com SLA estourado' : `${n} leads com SLA estourado`),
  },
  [AlertType.CRM_SLA_WARNING]: {
    permission: 'crm.leads.view',
    href: '/app/crm/sla',
    label: 'Ver SLA',
    message: (n) => (n === 1 ? '1 lead esfriando (SLA)' : `${n} leads esfriando (SLA)`),
  },
};

const MAX_INSIGHTS = 6;
const MAX_TASKS = 12;
const MAX_AGENDA_ITEMS = 40;
const AGENDA_WINDOW_DAYS = 7;
// Janela larga (visão de mês do widget calendário): mais dias = caps maiores,
// senão os takes da semana truncariam o fim do mês.
const MAX_AGENDA_WINDOW_DAYS = 42;
const MAX_AGENDA_ITEMS_WIDE = 160;
const PAYABLE_WINDOW_DAYS = 7;
// Fuso da OPERAÇÃO (a GDR é de Ribeirão Preto). O container do Railway roda
// em UTC: sem isto, "hoje" começaria às 21h do dia anterior no relógio da
// fábrica — o Meu Dia zeraria no meio do expediente da noite.
const BUSINESS_TZ = 'America/Sao_Paulo';
const MY_DAY_DEFAULT_DAYS = 30;
const MY_DAY_MAX_DAYS = 90;
// Fontes secundárias da Minha Mesa (expedição, SLA): poucos itens cada, para
// não afogar o inbox — o painel do domínio é que tem a lista inteira.
const SIDE_SOURCE_TAKE = 3;
// Venda faturada sem NENHUM documento entregue há tantos dias: vira crítico
// (reboque faturado que não pode rodar é dinheiro parado no pátio).
const VEHICLE_DOCS_CRITICAL_DAYS = 3;

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly approvalService: ApprovalService,
    private readonly vehicleDocumentService: VehicleDocumentService,
    private readonly funnelService: FunnelService,
  ) {}

  private async canOf(user: AuthUserLite): Promise<(code: string) => boolean> {
    const { permissions } = await this.permissionService.getUserPermissions(user.id, user.companyId);
    const set = new Set(permissions);
    return (code: string) => permissionMatches(set, code);
  }

  private brl(value: unknown, digits: 0 | 2 = 0): string {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(value ?? 0));
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDayIn(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private isoDay(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /**
   * Meia-noite do dia corrente NO FUSO DA OPERAÇÃO, expressa em UTC — não
   * depende do TZ do processo (Railway roda UTC). Subtrai do instante atual
   * as horas/minutos/segundos que o relógio de São Paulo marca agora.
   */
  private startOfBusinessDay(now = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: BUSINESS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    // 24 aparece em algumas implementações à meia-noite; normaliza para 0.
    const elapsedMs = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000;
    return new Date(now.getTime() - elapsedMs);
  }

  /** Data (YYYY-MM-DD) de um instante no fuso da operação. */
  private businessDate(now = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }

  /** current vs previous → variação %; null quando não há base (previous = 0). */
  private toDelta(current: number, previous: number): MyDayDelta {
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      current: round(current),
      previous: round(previous),
      deltaPct: previous > 0 ? round(((current - previous) / previous) * 100) : null,
    };
  }

  private refTime(value: Date | string | null | undefined): number {
    return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
  }

  private daysSince(value: Date | string | null | undefined): number {
    if (!value) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  }

  /** 45 → "45min"; 90 → "1h30"; 1500 → "1d" (subtítulo curto de pendência). */
  private humanMinutes(minutes: number): string {
    const m = Math.max(0, Math.round(minutes));
    if (m < 60) return `${m}min`;
    if (m < 1440) {
      const rest = m % 60;
      return rest ? `${Math.floor(m / 60)}h${String(rest).padStart(2, '0')}` : `${m / 60}h`;
    }
    const days = Math.floor(m / 1440);
    return `${days}d`;
  }

  private humanHours(hours: number): string {
    const h = Math.max(0, Math.round(hours));
    return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
  }

  // ─── Layout persistido (F2) ────────────────────────────────────────────────

  /** Layout salvo do usuário, ou null (= template puro do perfil). */
  async getLayout(user: AuthUserLite) {
    // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
    const row = await this.prisma.userWorkspaceLayout.findUnique({
      where: { userId: user.id },
    });
    if (!row) return null;
    return { profile: row.profile, version: row.version, widgets: row.layout };
  }

  async saveLayout(
    user: AuthUserLite,
    dto: { profile?: string; version: number; widgets: unknown[] },
  ) {
    const row = await this.prisma.userWorkspaceLayout.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        companyId: user.companyId,
        profile: dto.profile ?? null,
        version: dto.version,
        layout: dto.widgets as object[],
      },
      update: {
        profile: dto.profile ?? null,
        version: dto.version,
        layout: dto.widgets as object[],
      },
    });
    return { profile: row.profile, version: row.version, widgets: row.layout };
  }

  /** Reset = apagar a linha; a Home volta ao template puro do perfil. */
  async resetLayout(user: AuthUserLite) {
    // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
    await this.prisma.userWorkspaceLayout.deleteMany({ where: { userId: user.id } });
    return { reset: true };
  }

  // ─── Notas rápidas (post-its) ──────────────────────────────────────────────
  // Sempre do PRÓPRIO usuário: userId do JWT em TODO where. Nota é privada —
  // nunca cruza usuários, mesmo dentro da mesma empresa.

  private noteView(n: {
    id: string;
    text: string;
    color: string;
    position: number;
    pinnedAt: Date | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkspaceNote {
    return {
      id: n.id,
      text: n.text,
      color: n.color,
      position: n.position,
      pinned: n.pinnedAt != null,
      archived: n.archivedAt != null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    };
  }

  /**
   * Mural do usuário. `archived: true` abre a GAVETA (o que foi arrancado),
   * nunca misturada com o mural — arrancar tira da vista, não da existência.
   *
   * Ordem: fixadas primeiro, depois a ordem do mural (position), e o empate
   * cai em createdAt desc — é o que preserva o comportamento das notas
   * criadas antes de existir ordenação (todas com position 0).
   */
  async listNotes(user: AuthUserLite, archived = false): Promise<WorkspaceNote[]> {
    // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
    const notes = await this.prisma.userQuickNote.findMany({
      where: { userId: user.id, archivedAt: archived ? { not: null } : null },
      orderBy: archived
        ? [{ archivedAt: 'desc' }]
        : [
            { pinnedAt: { sort: 'desc', nulls: 'last' } },
            { position: 'asc' },
            { createdAt: 'desc' },
          ],
      take: 100,
    });
    return notes.map((n) => this.noteView(n));
  }

  async createNote(
    user: AuthUserLite,
    input: { text: string; color?: string },
  ): Promise<WorkspaceNote> {
    const note = await this.prisma.userQuickNote.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        text: input.text.trim(),
        color: input.color ?? 'yellow',
      },
    });
    return this.noteView(note);
  }

  async updateNote(
    user: AuthUserLite,
    id: string,
    patch: { text?: string; color?: string; pinned?: boolean; archived?: boolean },
  ): Promise<WorkspaceNote> {
    // updateMany com userId no where = escopo à prova de IDOR: nota de outro
    // usuário não é encontrada (count 0), nunca editada.
    const data: {
      text?: string;
      color?: string;
      pinnedAt?: Date | null;
      archivedAt?: Date | null;
    } = {};
    if (patch.text !== undefined) data.text = patch.text.trim();
    if (patch.color !== undefined) data.color = patch.color;
    // Fixar/arquivar são carimbos de tempo, não flags: o "quando" é o que
    // ordena a gaveta (mais recém-arquivada primeiro).
    if (patch.pinned !== undefined) data.pinnedAt = patch.pinned ? new Date() : null;
    if (patch.archived !== undefined) data.archivedAt = patch.archived ? new Date() : null;
    // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
    const res = await this.prisma.userQuickNote.updateMany({
      where: { id, userId: user.id },
      data,
    });
    if (res.count === 0) throw new NotFoundException('Nota não encontrada');
    // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
    const note = await this.prisma.userQuickNote.findFirstOrThrow({
      where: { id, userId: user.id },
    });
    return this.noteView(note);
  }

  /**
   * Nova ordem do mural: a posição de cada id vira o índice recebido. Só as
   * notas do PRÓPRIO usuário são tocadas (userId no where de cada update) e
   * tudo numa transação — mural meio reordenado seria pior que não reordenar.
   */
  async reorderNotes(user: AuthUserLite, ids: string[]): Promise<WorkspaceNote[]> {
    if (ids.length > 0) {
      await this.prisma.$transaction(
        ids.map((id, index) =>
          // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
          this.prisma.userQuickNote.updateMany({
            where: { id, userId: user.id },
            data: { position: index },
          }),
        ),
      );
    }
    return this.listNotes(user);
  }

  /** Excluir de vez (só faz sentido a partir da gaveta). Idempotente. */
  async deleteNote(user: AuthUserLite, id: string): Promise<{ deleted: boolean }> {
    // tenant-lint: ok (escopo por userId do JWT (dado pessoal do próprio usuário))
    await this.prisma.userQuickNote.deleteMany({ where: { id, userId: user.id } });
    return { deleted: true };
  }

  // ─── Resumo do Dia (insights) ──────────────────────────────────────────────

  async getInsights(user: AuthUserLite): Promise<{ insights: WorkspaceInsight[]; generatedAt: string }> {
    const can = await this.canOf(user);
    const insights: WorkspaceInsight[] = [];
    const now = new Date();
    const jobs: Promise<void>[] = [];

    // OPs além do prazo — regra prospectiva viva (mais atual que o cron de alertas)
    if (can('production.orders.view')) {
      jobs.push(
        this.prisma.productionOrder
          .count({
            where: {
              companyId: user.companyId,
              status: { in: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS] },
              scheduledEnd: { lt: now },
            },
          })
          .then((n) => {
            if (n > 0) {
              insights.push({
                id: 'production-late',
                severity: 'CRITICAL',
                count: n,
                message:
                  n === 1
                    ? '1 ordem de produção está além do prazo'
                    : `${n} ordens de produção estão além do prazo`,
                cta: { label: 'Ver OPs', href: '/app/production' },
              });
            }
          }),
      );
    }

    if (can('finance.entries.view')) {
      // Recebíveis vencidos (status OVERDUE ou em aberto com dueDate passada)
      jobs.push(
        this.prisma.financialEntry
          .aggregate({
            _sum: { amount: true },
            _count: true,
            where: {
              companyId: user.companyId,
              type: FinancialEntryType.RECEIVABLE,
              OR: [
                { status: FinancialEntryStatus.OVERDUE },
                {
                  status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
                  dueDate: { lt: this.startOfToday() },
                },
              ],
            },
          })
          .then((r) => {
            const total = Number(r._sum.amount ?? 0);
            if (total > 0) {
              insights.push({
                id: 'receivable-overdue',
                severity: 'WARNING',
                count: r._count,
                message: `${this.brl(total)} em recebíveis vencidos`,
                cta: { label: 'Ver cobrança', href: '/app/finance/receivables' },
              });
            }
          }),
      );
      // A pagar nos próximos 7 dias
      jobs.push(
        this.prisma.financialEntry
          .aggregate({
            _sum: { amount: true },
            _count: true,
            where: {
              companyId: user.companyId,
              type: FinancialEntryType.PAYABLE,
              status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
              dueDate: { gte: this.startOfToday(), lte: this.endOfDayIn(PAYABLE_WINDOW_DAYS) },
            },
          })
          .then((r) => {
            const total = Number(r._sum.amount ?? 0);
            if (total > 0) {
              insights.push({
                id: 'payable-upcoming',
                severity: 'INFO',
                count: r._count,
                message: `${this.brl(total)} a pagar nos próximos ${PAYABLE_WINDOW_DAYS} dias`,
                cta: { label: 'Ver contas a pagar', href: '/app/finance/payables' },
              });
            }
          }),
      );
    }

    // Documentos aguardando a MINHA alçada
    if (can('approvals.requests.view')) {
      jobs.push(
        // #1005: a fila é filtrada pelos PERFIS v2 do usuário (resolvidos no
        // ApprovalService), não mais pelo enum.
        this.approvalService.getPending(user.companyId, user.id).then((pending: unknown[]) => {
          const n = pending.length;
          if (n > 0) {
            insights.push({
              id: 'approvals-pending',
              severity: 'WARNING',
              count: n,
              message:
                n === 1 ? '1 documento aguardando sua aprovação' : `${n} documentos aguardando sua aprovação`,
              cta: { label: 'Ver aprovações', href: '/app/approvals' },
            });
          }
        }),
      );
    }

    // Inspeções de qualidade na fila
    if (can('quality.inspections.view')) {
      jobs.push(
        this.prisma.inspection
          .count({ where: { companyId: user.companyId, status: InspectionStatus.PENDING } })
          .then((n) => {
            if (n > 0) {
              insights.push({
                id: 'quality-pending',
                severity: 'INFO',
                count: n,
                message:
                  n === 1
                    ? '1 inspeção de qualidade aguardando'
                    : `${n} inspeções de qualidade aguardando`,
                cta: { label: 'Ver fila', href: '/app/quality' },
              });
            }
          }),
      );
    }

    // Rollups do hub de alertas (cada tipo gateado pela permissão do domínio)
    if (can('dashboard.alerts.view')) {
      const wantedTypes = (Object.keys(ALERT_ROLLUPS) as AlertType[]).filter((t) =>
        can(ALERT_ROLLUPS[t]!.permission),
      );
      if (wantedTypes.length > 0) {
        jobs.push(
          this.prisma.alert
            .findMany({
              where: { companyId: user.companyId, resolvedAt: null, type: { in: wantedTypes } },
              select: { type: true, severity: true },
            })
            .then((alerts) => {
              const byType = new Map<AlertType, { count: number; worst: AlertSeverity }>();
              for (const a of alerts) {
                const cur = byType.get(a.type) ?? { count: 0, worst: AlertSeverity.INFO };
                cur.count += 1;
                if (
                  a.severity === AlertSeverity.CRITICAL ||
                  (a.severity === AlertSeverity.WARNING && cur.worst === AlertSeverity.INFO)
                ) {
                  cur.worst = a.severity;
                }
                byType.set(a.type, cur);
              }
              for (const [type, { count, worst }] of byType) {
                const rollup = ALERT_ROLLUPS[type]!;
                insights.push({
                  id: `alert-${type.toLowerCase().replace(/_/g, '-')}`,
                  severity: worst === AlertSeverity.CRITICAL ? 'CRITICAL' : worst === AlertSeverity.WARNING ? 'WARNING' : 'INFO',
                  count,
                  message: rollup.message(count),
                  cta: { label: rollup.label, href: rollup.href },
                });
              }
            }),
        );
      }
    }

    // Uma fonte quebrada não derruba o resumo — degrada para os demais insights.
    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`insight source failed: ${err?.message ?? err}`))),
    );

    insights.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || (b.count ?? 0) - (a.count ?? 0),
    );
    return { insights: insights.slice(0, MAX_INSIGHTS), generatedAt: new Date().toISOString() };
  }

  // ─── Minhas Pendências (tasks) ─────────────────────────────────────────────

  async getTasks(user: AuthUserLite): Promise<WorkspaceTask[]> {
    const can = await this.canOf(user);
    const tasks: WorkspaceTask[] = [];
    const jobs: Promise<void>[] = [];

    if (can('approvals.requests.view')) {
      jobs.push(
        // #1005: idem — perfis v2 no service, enum fora.
        this.approvalService.getPending(user.companyId, user.id).then((pending: any[]) => {
          for (const p of pending.slice(0, 8)) {
            tasks.push({
              id: `approval-${p.documentType}-${p.id}`,
              type: 'approval',
              title:
                p.documentType === 'PO' ? 'Aprovar Pedido de Compra' : 'Aprovar Solicitação de Compra',
              subtitle:
                [p.supplier?.name, p.totalAmount != null ? this.brl(p.totalAmount, 2) : null]
                  .filter(Boolean)
                  .join(' · ') || undefined,
              href: '/app/approvals',
              createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
              priority: 'warning',
            });
          }
        }),
      );
    }

    if (can('crm.leads.view')) {
      jobs.push(
        this.prisma.leadReminder
          .findMany({
            where: { companyId: user.companyId, userId: user.id, doneAt: null },
            include: { lead: { select: { name: true } } },
            orderBy: { dueAt: 'asc' },
            take: 8,
          })
          .then((reminders) => {
            for (const r of reminders) {
              tasks.push({
                id: `crm-reminder-${r.id}`,
                type: 'crm-reminder',
                title: r.lead?.name ? `Follow-up: ${r.lead.name}` : `Follow-up: ${r.text}`,
                subtitle: r.lead?.name ? r.text : undefined,
                href: '/app/crm/leads',
                dueAt: r.dueAt.toISOString(),
                priority: 'info',
                // Concluível no clique: o mesmo endpoint que o inbox de CRM usa.
                // Exige crm.leads.annotate (o dono sempre tem); o backend valida.
                complete: { url: `/crm/reminders/${r.id}/done` },
              });
            }
          }),
      );
    }

    if (can('quality.inspections.view')) {
      jobs.push(
        this.prisma.inspection
          .findMany({
            where: { companyId: user.companyId, status: InspectionStatus.PENDING },
            orderBy: { createdAt: 'asc' },
            take: 8,
          })
          .then((inspections) => {
            for (const i of inspections) {
              tasks.push({
                id: `quality-inspection-${i.id}`,
                type: 'quality-inspection',
                title: 'Inspeção de qualidade pendente',
                href: '/app/quality',
                createdAt: i.createdAt.toISOString(),
                priority: 'warning',
              });
            }
          }),
      );
    }

    // Cobrança vencida — o item de DINHEIRO da Minha Mesa (crítico). Um card
    // resumo com a soma dos recebíveis vencidos, direto para a carteira.
    if (can('finance.entries.view')) {
      jobs.push(
        this.prisma.financialEntry
          .findMany({
            where: {
              companyId: user.companyId,
              type: FinancialEntryType.RECEIVABLE,
              status: {
                in: [
                  FinancialEntryStatus.OVERDUE,
                  FinancialEntryStatus.OPEN,
                  FinancialEntryStatus.PARTIALLY_PAID,
                ],
              },
              dueDate: { lt: this.startOfToday() },
            },
            select: { amount: true },
          })
          .then((entries) => {
            if (entries.length === 0) return;
            const total = entries.reduce((s, e) => s + Number(e.amount), 0);
            tasks.push({
              id: 'overdue-receivable',
              type: 'overdue-receivable',
              title:
                entries.length === 1
                  ? '1 cobrança vencida'
                  : `${entries.length} cobranças vencidas`,
              subtitle: this.brl(total, 2),
              href: '/app/finance/receivables',
              priority: 'critical',
            });
          }),
      );
    }

    // Expedição parada — venda de veículo FATURADA sem nenhum documento
    // regulatório entregue (CAT/CCT/projeto). Reusa a mesma consulta do widget
    // "Documentos do veículo" (#364); aqui vira pendência acionável, a mais
    // antiga primeiro. Faturada há dias = reboque que não sai do pátio: crítico.
    if (can('vehicle-tracking.documents.view')) {
      jobs.push(
        this.vehicleDocumentService.salesMissingDocuments(user.companyId).then((sales) => {
          const oldestFirst = [...sales].sort(
            (a, b) => this.refTime(a.invoicedAt ?? a.createdAt) - this.refTime(b.invoicedAt ?? b.createdAt),
          );
          for (const s of oldestFirst.slice(0, SIDE_SOURCE_TAKE)) {
            const since = s.invoicedAt ?? s.createdAt;
            const days = this.daysSince(since);
            tasks.push({
              id: `vehicle-docs-${s.id}`,
              type: 'vehicle-docs-pending',
              title: 'Documentos do veículo pendentes',
              subtitle: `Venda faturada${days >= 1 ? ` há ${days} ${days === 1 ? 'dia' : 'dias'}` : ' hoje'} sem documento entregue`,
              href: `/app/sales/${s.id}`,
              createdAt: since ? new Date(since).toISOString() : undefined,
              priority: days >= VEHICLE_DOCS_CRITICAL_DAYS ? 'critical' : 'warning',
            });
          }
        }),
      );
    }

    // Cliente aguardando — SLA de primeira resposta estourado (crítico) e lead
    // esfriando (atenção), SEMPRE no escopo MEU (assignedToId = eu): é a Minha
    // Mesa, não o painel do gerente. Mesma fonte do painel /crm/sla (#516).
    if (can('crm.leads.view')) {
      jobs.push(
        this.funnelService.slaPanel(user.companyId, user.id).then((panel) => {
          for (const l of panel.breaching.slice(0, SIDE_SOURCE_TAKE)) {
            tasks.push({
              id: `crm-sla-breach-${l.id}`,
              type: 'crm-sla',
              title: `Cliente aguardando: ${l.name ?? 'lead sem nome'}`,
              subtitle: `Sem primeira resposta há ${this.humanMinutes(l.waitingMinutes)} (SLA ${this.humanMinutes(panel.slaMinutes)})`,
              href: '/app/crm/sla',
              createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : undefined,
              priority: 'critical',
            });
          }
          for (const l of panel.cooling.slice(0, SIDE_SOURCE_TAKE)) {
            tasks.push({
              id: `crm-sla-cooling-${l.id}`,
              type: 'crm-sla',
              title: `Lead esfriando: ${l.name ?? 'lead sem nome'}`,
              subtitle:
                l.idleHours != null
                  ? `Sem interação há ${this.humanHours(l.idleHours)}`
                  : `Sem interação há mais de ${this.humanHours(panel.coolingHours)}`,
              href: '/app/crm/sla',
              createdAt: l.lastInteractionAt ? new Date(l.lastInteractionAt).toISOString() : undefined,
              priority: 'warning',
            });
          }
        }),
      );
    }

    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`task source failed: ${err?.message ?? err}`))),
    );

    // Minha Mesa: prioridade primeiro (crítico → atenção → info), depois o mais
    // antigo dentro do mesmo nível (pendência velha é pendência esquecida).
    const rank = { critical: 0, warning: 1, info: 2, undefined: 3 } as const;
    tasks.sort(
      (a, b) =>
        rank[a.priority ?? 'undefined'] - rank[b.priority ?? 'undefined'] ||
        (a.dueAt ?? a.createdAt ?? '').localeCompare(b.dueAt ?? b.createdAt ?? ''),
    );
    return tasks.slice(0, MAX_TASKS);
  }

  // ─── Meu Dia (hoje + variação do período) ──────────────────────────────────

  /**
   * Meu Dia: o que ANDOU hoje e como o período se compara com o anterior.
   *
   * Só entra evento com carimbo de tempo real no schema — faturamento por
   * `invoicedAt` (venda com NF emitida), recebimento por `paidAt`, produção
   * por `completedAt`. Nada de estimativa, nada de meta.
   *
   * Curadoria por permissão, como o resto do BFF: quem não enxerga vendas não
   * dispara a consulta de faturamento nem recebe a chave no payload.
   */
  async getMyDay(user: AuthUserLite, days = MY_DAY_DEFAULT_DAYS): Promise<MyDaySummary> {
    const window = Math.min(Math.max(days, 1), MY_DAY_MAX_DAYS);
    const can = await this.canOf(user);
    const now = new Date();
    const todayStart = this.startOfBusinessDay(now);
    const dayMs = 86_400_000;
    const currentStart = new Date(now.getTime() - window * dayMs);
    const previousStart = new Date(now.getTime() - 2 * window * dayMs);

    const summary: MyDaySummary = {
      date: this.businessDate(now),
      periodDays: window,
      today: {},
      period: {},
    };
    const jobs: Promise<void>[] = [];

    // Faturado — venda com NF emitida (status INVOICED + invoicedAt).
    if (can('sales.orders.view')) {
      jobs.push(
        this.prisma.salesOrder
          .findMany({
            where: {
              companyId: user.companyId,
              status: SalesOrderStatus.INVOICED,
              invoicedAt: { gte: previousStart },
            },
            select: {
              invoicedAt: true,
              items: { select: { quantity: true, unitPrice: true } },
            },
          })
          .then((orders) => {
            const amountOf = (o: (typeof orders)[number]) =>
              o.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
            let todayAmount = 0;
            let todayCount = 0;
            let current = 0;
            let previous = 0;
            for (const o of orders) {
              if (!o.invoicedAt) continue;
              const amount = amountOf(o);
              if (o.invoicedAt >= todayStart) {
                todayAmount += amount;
                todayCount += 1;
              }
              if (o.invoicedAt >= currentStart) current += amount;
              else previous += amount;
            }
            summary.today.invoiced = { amount: Math.round(todayAmount * 100) / 100, count: todayCount };
            summary.period.invoiced = this.toDelta(current, previous);
          }),
      );
    }

    // Recebido — dinheiro que ENTROU (paidAt). Baixa parcial conta pelo valor
    // efetivamente pago; registros antigos sem paidAmount caem no amount.
    if (can('finance.entries.view')) {
      jobs.push(
        this.prisma.financialEntry
          .findMany({
            where: {
              companyId: user.companyId,
              type: FinancialEntryType.RECEIVABLE,
              status: { in: [FinancialEntryStatus.PAID, FinancialEntryStatus.PARTIALLY_PAID] },
              paidAt: { gte: previousStart },
            },
            select: { paidAt: true, paidAmount: true, amount: true },
          })
          .then((entries) => {
            let todayAmount = 0;
            let todayCount = 0;
            let current = 0;
            let previous = 0;
            for (const e of entries) {
              if (!e.paidAt) continue;
              const amount = Number(e.paidAmount ?? e.amount);
              if (e.paidAt >= todayStart) {
                todayAmount += amount;
                todayCount += 1;
              }
              if (e.paidAt >= currentStart) current += amount;
              else previous += amount;
            }
            summary.today.received = { amount: Math.round(todayAmount * 100) / 100, count: todayCount };
            summary.period.received = this.toDelta(current, previous);
          }),
      );
    }

    // Produzido — OP concluída (status DONE + completedAt), com a quantidade
    // que saiu de fato (producedQty, o mesmo campo da barra de progresso).
    if (can('production.orders.view')) {
      jobs.push(
        this.prisma.productionOrder
          .findMany({
            where: {
              companyId: user.companyId,
              status: ProductionOrderStatus.DONE,
              completedAt: { gte: previousStart },
            },
            select: { completedAt: true, producedQty: true },
          })
          .then((orders) => {
            let todayQty = 0;
            let todayOrders = 0;
            let current = 0;
            let previous = 0;
            for (const o of orders) {
              if (!o.completedAt) continue;
              const qty = Number(o.producedQty);
              if (o.completedAt >= todayStart) {
                todayQty += qty;
                todayOrders += 1;
              }
              // A variação de produção conta ORDENS concluídas — quantidade
              // mistura reboque com peça avulsa e não compara.
              if (o.completedAt >= currentStart) current += 1;
              else previous += 1;
            }
            summary.today.produced = { orders: todayOrders, qty: Math.round(todayQty * 100) / 100 };
            summary.period.produced = this.toDelta(current, previous);
          }),
      );
    }

    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`my-day source failed: ${err?.message ?? err}`))),
    );

    return summary;
  }

  // ─── Faturamento (série real, por venda faturada) ──────────────────────────

  /**
   * Faturamento do período: um ponto por DIA, somando as vendas cuja NF foi
   * emitida naquele dia (`status = INVOICED`, carimbo `invoicedAt`).
   *
   * Existe porque a Home lia `/analytics/sales-cube`, que agrupa por MÊS de
   * `createdAt` e não filtra status — o KPI somava rascunho e cancelado, e o
   * gráfico de 30 dias virava um ou dois pontos mensais. Aqui o número bate
   * exatamente com `period.invoiced` do Meu Dia: mesma base, mesma verdade.
   *
   * Dias sem faturamento aparecem com valor 0 — a linha do gráfico precisa do
   * eixo contínuo, e "não faturamos nada naquele dia" é informação.
   */
  async getRevenueSeries(user: AuthUserLite, days = MY_DAY_DEFAULT_DAYS): Promise<RevenueSeries> {
    const window = Math.min(Math.max(days, 1), MY_DAY_MAX_DAYS);
    const dayMs = 86_400_000;
    const now = new Date();
    // Começa na meia-noite (fuso da operação) de N-1 dias atrás: a janela
    // cobre dias INTEIROS, incluindo o de hoje.
    const from = new Date(this.startOfBusinessDay(now).getTime() - (window - 1) * dayMs);

    const orders = await this.prisma.salesOrder.findMany({
      where: {
        companyId: user.companyId,
        status: SalesOrderStatus.INVOICED,
        invoicedAt: { gte: from },
      },
      select: { invoicedAt: true, items: { select: { quantity: true, unitPrice: true } } },
    });

    const byDay = new Map<string, number>();
    for (let i = 0; i < window; i++) {
      byDay.set(this.businessDate(new Date(from.getTime() + i * dayMs)), 0);
    }
    for (const o of orders) {
      if (!o.invoicedAt) continue;
      const key = this.businessDate(o.invoicedAt);
      if (!byDay.has(key)) continue; // fora da janela por arredondamento de fuso
      const amount = o.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0);
      byDay.set(key, byDay.get(key)! + amount);
    }

    const series = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, value]) => ({ period, value: Math.round(value * 100) / 100 }));

    return {
      periodDays: window,
      total: Math.round(series.reduce((s, p) => s + p.value, 0) * 100) / 100,
      series,
    };
  }

  // ─── Agenda (próximos 7 dias) ──────────────────────────────────────────────

  async getAgenda(user: AuthUserLite, days = AGENDA_WINDOW_DAYS): Promise<AgendaItem[]> {
    const window = Math.min(Math.max(days, 1), MAX_AGENDA_WINDOW_DAYS);
    const wide = window > AGENDA_WINDOW_DAYS;
    const can = await this.canOf(user);
    const items: AgendaItem[] = [];
    const jobs: Promise<void>[] = [];
    const from = this.startOfToday();
    const to = this.endOfDayIn(window);
    const todayIso = this.isoDay(from);

    if (can('finance.entries.view')) {
      jobs.push(
        this.prisma.financialEntry
          .findMany({
            where: {
              companyId: user.companyId,
              status: { in: [FinancialEntryStatus.OPEN, FinancialEntryStatus.PARTIALLY_PAID] },
              dueDate: { gte: from, lte: to },
            },
            orderBy: { dueDate: 'asc' },
            take: wide ? 100 : 20,
          })
          .then((entries) => {
            for (const e of entries) {
              const payable = e.type === FinancialEntryType.PAYABLE;
              const date = this.isoDay(e.dueDate);
              items.push({
                id: `finance-${e.id}`,
                date,
                kind: 'finance-due',
                title: `${payable ? 'Pagar' : 'Receber'} ${this.brl(e.amount, 2)}${e.description ? ` — ${e.description}` : ''}`,
                href: payable ? '/app/finance/payables' : '/app/finance/receivables',
                tone: payable && date === todayIso ? 'warning' : 'neutral',
                amount: Number(e.amount),
              });
            }
          }),
      );
    }

    if (can('production.orders.view')) {
      jobs.push(
        this.prisma.productionOrder
          .findMany({
            where: {
              companyId: user.companyId,
              status: { in: [ProductionOrderStatus.RELEASED, ProductionOrderStatus.IN_PROGRESS] },
              scheduledEnd: { gte: from, lte: to },
            },
            include: { product: { select: { name: true } } },
            orderBy: { scheduledEnd: 'asc' },
            take: wide ? 40 : 10,
          })
          .then((orders) => {
            for (const o of orders) {
              items.push({
                id: `production-${o.id}`,
                date: this.isoDay(o.scheduledEnd!),
                kind: 'production-end',
                title: `OP de ${o.product?.name ?? 'produto'} termina`,
                href: '/app/production',
                tone: 'neutral',
              });
            }
          }),
      );
    }

    if (can('crm.leads.view')) {
      jobs.push(
        this.prisma.leadReminder
          .findMany({
            where: {
              companyId: user.companyId,
              userId: user.id,
              doneAt: null,
              dueAt: { gte: from, lte: to },
            },
            include: { lead: { select: { name: true } } },
            orderBy: { dueAt: 'asc' },
            take: wide ? 40 : 10,
          })
          .then((reminders) => {
            for (const r of reminders) {
              items.push({
                id: `crm-${r.id}`,
                date: this.isoDay(r.dueAt),
                kind: 'crm-reminder',
                title: r.lead?.name ? `Follow-up: ${r.lead.name}` : `Follow-up: ${r.text}`,
                href: '/app/crm/leads',
                tone: 'neutral',
              });
            }
          }),
      );
    }

    await Promise.all(
      jobs.map((j) => j.catch((err) => this.logger.warn(`agenda source failed: ${err?.message ?? err}`))),
    );

    items.sort((a, b) => a.date.localeCompare(b.date));
    return items.slice(0, wide ? MAX_AGENDA_ITEMS_WIDE : MAX_AGENDA_ITEMS);
  }
}
