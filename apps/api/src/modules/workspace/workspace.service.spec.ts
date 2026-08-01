import { Test, TestingModule } from '@nestjs/testing';
import { AlertSeverity, AlertType } from '@prisma/client';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';
import { ApprovalService } from '../approval/approval.service';
import { VehicleDocumentService } from '../vehicle-document/vehicle-document.service';
import { FunnelService } from '../crm/funnel.service';

/**
 * WorkspaceService (F1) — o contrato central é a CURADORIA POR PERMISSÃO:
 * fonte sem permissão não roda (nem a consulta ao banco é disparada) e o
 * payload nunca contém dado de módulo que o usuário não enxerga.
 */

const USER = { id: 'user-1', companyId: 'company-1', role: 'MANAGER' };

const ALL_PERMS = [
  'production.orders.view',
  'finance.entries.view',
  'approvals.requests.view',
  'quality.inspections.view',
  'dashboard.alerts.view',
  'stock.balances.view',
  'crm.leads.view',
  'fiscal.documents.view',
  'fiscal.manifestation.view',
  'maintenance.orders.view',
  'vehicle-tracking.documents.view',
  'sales.orders.view',
];

const EMPTY_SLA_PANEL = { slaMinutes: 30, coolingHours: 48, breaching: [], cooling: [] };

const mockPrisma = {
  salesOrder: { findMany: jest.fn() },
  productionOrder: { count: jest.fn(), findMany: jest.fn() },
  financialEntry: { aggregate: jest.fn(), findMany: jest.fn() },
  inspection: { count: jest.fn(), findMany: jest.fn() },
  alert: { findMany: jest.fn() },
  leadReminder: { findMany: jest.fn() },
  userWorkspaceLayout: { findUnique: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
  userQuickNote: {
    findMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findFirstOrThrow: jest.fn(),
    deleteMany: jest.fn(),
  },
};

const mockPermissionService = { getUserPermissions: jest.fn() };
const mockApprovalService = { getPending: jest.fn() };
const mockVehicleDocumentService = { salesMissingDocuments: jest.fn() };
const mockFunnelService = { slaPanel: jest.fn() };

function grant(permissions: string[]) {
  mockPermissionService.getUserPermissions.mockResolvedValue({ roles: [], permissions });
}

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // defaults vazios — cada teste liga o que precisa
    mockPrisma.productionOrder.count.mockResolvedValue(0);
    mockPrisma.productionOrder.findMany.mockResolvedValue([]);
    mockPrisma.financialEntry.aggregate.mockResolvedValue({ _sum: { amount: 0 }, _count: 0 });
    mockPrisma.financialEntry.findMany.mockResolvedValue([]);
    mockPrisma.salesOrder.findMany.mockResolvedValue([]);
    mockPrisma.inspection.count.mockResolvedValue(0);
    mockPrisma.inspection.findMany.mockResolvedValue([]);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.leadReminder.findMany.mockResolvedValue([]);
    mockApprovalService.getPending.mockResolvedValue([]);
    mockVehicleDocumentService.salesMissingDocuments.mockResolvedValue([]);
    mockFunnelService.slaPanel.mockResolvedValue(EMPTY_SLA_PANEL);
    grant(ALL_PERMS);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: ApprovalService, useValue: mockApprovalService },
        { provide: VehicleDocumentService, useValue: mockVehicleDocumentService },
        { provide: FunnelService, useValue: mockFunnelService },
      ],
    }).compile();

    service = module.get(WorkspaceService);
  });

  describe('getInsights', () => {
    it('ordena por severidade (CRITICAL antes de WARNING antes de INFO)', async () => {
      mockPrisma.productionOrder.count.mockResolvedValue(3); // CRITICAL
      mockPrisma.inspection.count.mockResolvedValue(4); // INFO
      mockApprovalService.getPending.mockResolvedValue([{}, {}]); // WARNING

      const { insights } = await service.getInsights(USER);
      const ids = insights.map((i) => i.id);
      expect(ids).toEqual(['production-late', 'approvals-pending', 'quality-pending']);
      expect(insights[0].severity).toBe('CRITICAL');
      expect(insights[0].cta).toEqual({ label: 'Ver OPs', href: '/app/production' });
    });

    it('sem permissão financeira: consulta financeira NEM RODA e insight não aparece', async () => {
      grant(['production.orders.view']);
      mockPrisma.productionOrder.count.mockResolvedValue(1);

      const { insights } = await service.getInsights(USER);
      expect(mockPrisma.financialEntry.aggregate).not.toHaveBeenCalled();
      expect(mockApprovalService.getPending).not.toHaveBeenCalled();
      expect(insights.map((i) => i.id)).toEqual(['production-late']);
    });

    it('agrupa alertas por tipo com a pior severidade e gateia pelo domínio', async () => {
      grant(['dashboard.alerts.view', 'stock.balances.view']);
      mockPrisma.alert.findMany.mockResolvedValue([
        { type: AlertType.STOCK_MIN, severity: AlertSeverity.WARNING },
        { type: AlertType.STOCK_MIN, severity: AlertSeverity.CRITICAL },
      ]);

      const { insights } = await service.getInsights(USER);
      expect(insights).toHaveLength(1);
      expect(insights[0]).toMatchObject({
        id: 'alert-stock-min',
        severity: 'CRITICAL',
        count: 2,
        cta: { href: '/app/stock' },
      });
      // só o tipo permitido entra na consulta (fiscal/crm/maintenance fora)
      const where = mockPrisma.alert.findMany.mock.calls[0][0].where;
      expect(where.type.in).toEqual([AlertType.STOCK_MIN]);
    });

    it('fonte quebrada degrada sem derrubar o resumo', async () => {
      mockPrisma.productionOrder.count.mockRejectedValue(new Error('db down'));
      mockPrisma.inspection.count.mockResolvedValue(2);

      const { insights } = await service.getInsights(USER);
      expect(insights.map((i) => i.id)).toContain('quality-pending');
      expect(insights.map((i) => i.id)).not.toContain('production-late');
    });

    it('zero em tudo → lista vazia (o widget dá a voz de "tudo em ordem")', async () => {
      const { insights, generatedAt } = await service.getInsights(USER);
      expect(insights).toEqual([]);
      expect(generatedAt).toBeTruthy();
    });
  });

  describe('getTasks', () => {
    it('mescla as 3 fontes ordenando do mais antigo para o mais novo', async () => {
      mockApprovalService.getPending.mockResolvedValue([
        {
          id: 'po1',
          documentType: 'PO',
          totalAmount: 1500,
          supplier: { name: 'Fornecedor X' },
          createdAt: new Date('2026-07-28T10:00:00Z'),
        },
      ]);
      mockPrisma.leadReminder.findMany.mockResolvedValue([
        {
          id: 'rem1',
          text: 'Ligar 14h',
          dueAt: new Date('2026-07-27T14:00:00Z'),
          lead: { name: 'Cliente Y' },
        },
      ]);
      mockPrisma.inspection.findMany.mockResolvedValue([
        { id: 'insp1', createdAt: new Date('2026-07-29T08:00:00Z') },
      ]);

      const tasks = await service.getTasks(USER);
      // Minha Mesa ordena por PRIORIDADE: aprovação+inspeção (warning, por data)
      // antes do follow-up de CRM (info). Sem cobrança vencida no mock.
      expect(tasks.map((t) => t.type)).toEqual(['approval', 'quality-inspection', 'crm-reminder']);
      expect(tasks[0].subtitle).toContain('Fornecedor X');
      expect(tasks[0].href).toBe('/app/approvals');
      expect(tasks[0].priority).toBe('warning');
      // Só o lembrete de CRM é concluível no clique; aprovação/inspeção não.
      const crm = tasks.find((t) => t.type === 'crm-reminder')!;
      expect(crm.complete).toEqual({ url: '/crm/reminders/rem1/done' });
      expect(crm.priority).toBe('info');
      expect(tasks.find((t) => t.type === 'approval')!.complete).toBeUndefined();
    });

    it('cobrança vencida entra como item crítico (topo) com a soma dos recebíveis', async () => {
      mockPrisma.financialEntry.findMany.mockResolvedValue([{ amount: 30000 }, { amount: 18000 }]);
      const tasks = await service.getTasks(USER);
      expect(tasks[0].type).toBe('overdue-receivable');
      expect(tasks[0].priority).toBe('critical');
      expect(tasks[0].title).toBe('2 cobranças vencidas');
      expect(tasks[0].href).toBe('/app/finance/receivables');
    });

    it('sem permissão de aprovações: getPending não é chamado', async () => {
      grant(['crm.leads.view']);
      await service.getTasks(USER);
      expect(mockApprovalService.getPending).not.toHaveBeenCalled();
      expect(mockPrisma.inspection.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.leadReminder.findMany).toHaveBeenCalled();
    });

    it('expedição parada: venda faturada há dias vira item crítico, mais antiga primeiro', async () => {
      const day = 86_400_000;
      mockVehicleDocumentService.salesMissingDocuments.mockResolvedValue([
        { id: 'so-nova', invoicedAt: new Date(Date.now() - day), createdAt: new Date() },
        { id: 'so-velha', invoicedAt: new Date(Date.now() - 6 * day), createdAt: new Date() },
      ]);

      const tasks = await service.getTasks(USER);
      const docs = tasks.filter((t) => t.type === 'vehicle-docs-pending');
      expect(docs.map((t) => t.id)).toEqual(['vehicle-docs-so-velha', 'vehicle-docs-so-nova']);
      expect(docs[0].priority).toBe('critical'); // 6 dias ≥ limiar
      expect(docs[0].subtitle).toContain('há 6 dias');
      expect(docs[0].href).toBe('/app/sales/so-velha');
      expect(docs[1].priority).toBe('warning'); // 1 dia
      // Item de expedição não se resolve num clique daqui.
      expect(docs[0].complete).toBeUndefined();
    });

    it('SLA: lead sem primeira resposta é crítico, esfriando é atenção — sempre no MEU escopo', async () => {
      mockFunnelService.slaPanel.mockResolvedValue({
        slaMinutes: 30,
        coolingHours: 48,
        breaching: [
          { id: 'lead-1', name: 'Transportes Silva', waitingMinutes: 95, createdAt: new Date() },
        ],
        cooling: [
          { id: 'lead-2', name: 'Reboques Norte', idleHours: 72, lastInteractionAt: new Date() },
        ],
      });

      const tasks = await service.getTasks(USER);
      expect(mockFunnelService.slaPanel).toHaveBeenCalledWith(USER.companyId, USER.id);

      const breach = tasks.find((t) => t.id === 'crm-sla-breach-lead-1')!;
      expect(breach.type).toBe('crm-sla');
      expect(breach.priority).toBe('critical');
      expect(breach.title).toBe('Cliente aguardando: Transportes Silva');
      expect(breach.subtitle).toBe('Sem primeira resposta há 1h35 (SLA 30min)');
      expect(breach.href).toBe('/app/crm/sla');

      const cooling = tasks.find((t) => t.id === 'crm-sla-cooling-lead-2')!;
      expect(cooling.priority).toBe('warning');
      expect(cooling.subtitle).toBe('Sem interação há 3d');
    });

    it('sem permissão de documentos do veículo: a consulta de expedição não roda', async () => {
      grant(['finance.entries.view']);
      await service.getTasks(USER);
      expect(mockVehicleDocumentService.salesMissingDocuments).not.toHaveBeenCalled();
      expect(mockFunnelService.slaPanel).not.toHaveBeenCalled();
    });

    it('lembretes são sempre do PRÓPRIO usuário (userId no where)', async () => {
      await service.getTasks(USER);
      const where = mockPrisma.leadReminder.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe(USER.id);
      expect(where.companyId).toBe(USER.companyId);
      expect(where.doneAt).toBeNull();
    });
  });

  describe('getMyDay', () => {
    const DAY = 86_400_000;
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
    const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

    it('separa o que andou HOJE e compara o período com o anterior', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([
        // hoje (1h atrás): 2 × 1000 + 1 × 500 = 2500
        { invoicedAt: hoursAgo(1), items: [{ quantity: 2, unitPrice: 1000 }, { quantity: 1, unitPrice: 500 }] },
        // dentro do período (10 dias): 1000
        { invoicedAt: daysAgo(10), items: [{ quantity: 1, unitPrice: 1000 }] },
        // período anterior (40 dias): 2000
        { invoicedAt: daysAgo(40), items: [{ quantity: 1, unitPrice: 2000 }] },
      ]);
      mockPrisma.financialEntry.findMany.mockResolvedValue([
        { paidAt: hoursAgo(2), paidAmount: 300, amount: 900 }, // baixa parcial conta o pago
        { paidAt: daysAgo(50), paidAmount: null, amount: 700 }, // legado sem paidAmount
      ]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        { completedAt: hoursAgo(3), producedQty: 4 },
        { completedAt: daysAgo(5), producedQty: 6 },
        { completedAt: daysAgo(45), producedQty: 10 },
      ]);

      const myDay = await service.getMyDay(USER, 30);

      expect(myDay.periodDays).toBe(30);
      expect(myDay.today.invoiced).toEqual({ amount: 2500, count: 1 });
      expect(myDay.today.received).toEqual({ amount: 300, count: 1 });
      expect(myDay.today.produced).toEqual({ orders: 1, qty: 4 });

      // faturado: 3500 no período vs 2000 no anterior → +75%
      expect(myDay.period.invoiced).toEqual({ current: 3500, previous: 2000, deltaPct: 75 });
      // recebido: 300 vs 700 (usou o amount do registro sem paidAmount)
      expect(myDay.period.received!.previous).toBe(700);
      expect(myDay.period.received!.deltaPct).toBeCloseTo(-57.14, 1);
      // produção compara ORDENS concluídas, não quantidade
      expect(myDay.period.produced).toEqual({ current: 2, previous: 1, deltaPct: 100 });
    });

    it('sem base de comparação (período anterior zerado) o delta é null, nunca infinito', async () => {
      mockPrisma.salesOrder.findMany.mockResolvedValue([
        { invoicedAt: hoursAgo(1), items: [{ quantity: 1, unitPrice: 1000 }] },
      ]);
      const myDay = await service.getMyDay(USER, 30);
      expect(myDay.period.invoiced).toEqual({ current: 1000, previous: 0, deltaPct: null });
    });

    it('"hoje" é o dia da OPERAÇÃO (America/Sao_Paulo), não o dia UTC do container', async () => {
      // 02:00 UTC = 23:00 do dia ANTERIOR em São Paulo: o dia de trabalho ainda
      // é 30/07, e um faturamento das 09:00 BRT do dia 30 tem que contar.
      jest.useFakeTimers().setSystemTime(new Date('2026-07-31T02:00:00Z'));
      try {
        mockPrisma.salesOrder.findMany.mockResolvedValue([
          { invoicedAt: new Date('2026-07-30T12:00:00Z'), items: [{ quantity: 1, unitPrice: 800 }] },
        ]);
        const myDay = await service.getMyDay(USER, 30);
        expect(myDay.date).toBe('2026-07-30');
        expect(myDay.today.invoiced).toEqual({ amount: 800, count: 1 });
      } finally {
        jest.useRealTimers();
      }
    });

    it('curadoria por permissão: sem vendas, a consulta não roda e a chave não vem', async () => {
      grant(['production.orders.view']);
      const myDay = await service.getMyDay(USER, 7);
      expect(mockPrisma.salesOrder.findMany).not.toHaveBeenCalled();
      expect(myDay.today.invoiced).toBeUndefined();
      expect(myDay.period.invoiced).toBeUndefined();
      expect(myDay.today.produced).toBeDefined();
    });

    it('a janela é limitada (1..90 dias)', async () => {
      const myDay = await service.getMyDay(USER, 999);
      expect(myDay.periodDays).toBe(90);
    });
  });

  describe('getRevenueSeries', () => {
    it('um ponto por dia da janela, somando só venda com NF emitida', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-31T15:00:00Z')); // 12h BRT
      try {
        mockPrisma.salesOrder.findMany.mockResolvedValue([
          { invoicedAt: new Date('2026-07-31T13:00:00Z'), items: [{ quantity: 2, unitPrice: 1000 }] },
          { invoicedAt: new Date('2026-07-31T17:00:00Z'), items: [{ quantity: 1, unitPrice: 500 }] },
          { invoicedAt: new Date('2026-07-29T14:00:00Z'), items: [{ quantity: 1, unitPrice: 300 }] },
        ]);

        const out = await service.getRevenueSeries(USER, 7);

        expect(out.periodDays).toBe(7);
        expect(out.series).toHaveLength(7); // dias vazios inclusos (eixo contínuo)
        expect(out.series[out.series.length - 1]).toEqual({ period: '2026-07-31', value: 2500 });
        expect(out.series.find((p) => p.period === '2026-07-29')).toEqual({
          period: '2026-07-29',
          value: 300,
        });
        expect(out.series.find((p) => p.period === '2026-07-30')).toEqual({
          period: '2026-07-30',
          value: 0,
        });
        expect(out.total).toBe(2800);

        // Só INVOICED entra na consulta — rascunho/cancelado nunca chegam aqui.
        const where = mockPrisma.salesOrder.findMany.mock.calls[0][0].where;
        expect(where.status).toBe('INVOICED');
        expect(where.companyId).toBe(USER.companyId);
      } finally {
        jest.useRealTimers();
      }
    });

    it('o total da série bate com o período do Meu Dia (mesma base)', async () => {
      const orders = [
        { invoicedAt: new Date(Date.now() - 3600_000), items: [{ quantity: 3, unitPrice: 700 }] },
      ];
      mockPrisma.salesOrder.findMany.mockResolvedValue(orders);
      const [series, myDay] = await Promise.all([
        service.getRevenueSeries(USER, 30),
        service.getMyDay(USER, 30),
      ]);
      expect(series.total).toBe(2100);
      expect(myDay.period.invoiced!.current).toBe(2100);
    });

    it('a janela é limitada (1..90 dias)', async () => {
      const out = await service.getRevenueSeries(USER, 999);
      expect(out.periodDays).toBe(90);
      expect(out.series).toHaveLength(90);
    });
  });

  describe('notas rápidas', () => {
    const NOTE = {
      id: 'n1',
      text: 'Ligar transportadora',
      color: 'yellow',
      createdAt: new Date('2026-07-31T10:00:00Z'),
      updatedAt: new Date('2026-07-31T10:00:00Z'),
    };

    it('lista só as do próprio usuário, mais recentes primeiro', async () => {
      mockPrisma.userQuickNote.findMany.mockResolvedValue([NOTE]);
      const notes = await service.listNotes(USER);
      const where = mockPrisma.userQuickNote.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe(USER.id);
      expect(mockPrisma.userQuickNote.findMany.mock.calls[0][0].orderBy).toEqual({
        createdAt: 'desc',
      });
      expect(notes[0]).toMatchObject({ id: 'n1', text: 'Ligar transportadora', color: 'yellow' });
      expect(typeof notes[0].createdAt).toBe('string');
    });

    it('cria com userId+companyId do JWT e trima o texto', async () => {
      mockPrisma.userQuickNote.create.mockResolvedValue(NOTE);
      await service.createNote(USER, { text: '  nota  ', color: 'pink' });
      const data = mockPrisma.userQuickNote.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        userId: USER.id,
        companyId: USER.companyId,
        text: 'nota',
        color: 'pink',
      });
    });

    it('update escopa por userId (IDOR-safe) e 404 quando não é do dono', async () => {
      mockPrisma.userQuickNote.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.updateNote(USER, 'alheia', { text: 'x' })).rejects.toThrow(
        'Nota não encontrada',
      );
      const where = mockPrisma.userQuickNote.updateMany.mock.calls[0][0].where;
      expect(where).toEqual({ id: 'alheia', userId: USER.id });
    });

    it('arrancar (delete) escopa por userId e é idempotente', async () => {
      mockPrisma.userQuickNote.deleteMany.mockResolvedValue({ count: 1 });
      expect(await service.deleteNote(USER, 'n1')).toEqual({ deleted: true });
      expect(mockPrisma.userQuickNote.deleteMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: USER.id },
      });
    });
  });

  describe('layout (F2)', () => {
    it('getLayout devolve null sem linha (template puro) e o shape salvo quando existe', async () => {
      mockPrisma.userWorkspaceLayout.findUnique.mockResolvedValue(null);
      expect(await service.getLayout(USER)).toBeNull();

      mockPrisma.userWorkspaceLayout.findUnique.mockResolvedValue({
        profile: 'purchasing',
        version: 1,
        layout: [{ id: 'agenda', hidden: true }],
      });
      expect(await service.getLayout(USER)).toEqual({
        profile: 'purchasing',
        version: 1,
        widgets: [{ id: 'agenda', hidden: true }],
      });
      expect(mockPrisma.userWorkspaceLayout.findUnique).toHaveBeenCalledWith({
        where: { userId: USER.id },
      });
    });

    it('saveLayout faz upsert SEMPRE do próprio usuário, com companyId do JWT', async () => {
      mockPrisma.userWorkspaceLayout.upsert.mockResolvedValue({
        profile: null,
        version: 1,
        layout: [{ id: 'chart-revenue', size: 'full' }],
      });
      await service.saveLayout(USER, {
        version: 1,
        widgets: [{ id: 'chart-revenue', size: 'full' }],
      });
      const args = mockPrisma.userWorkspaceLayout.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ userId: USER.id });
      expect(args.create.userId).toBe(USER.id);
      expect(args.create.companyId).toBe(USER.companyId);
    });

    it('resetLayout apaga só a linha do próprio usuário', async () => {
      mockPrisma.userWorkspaceLayout.deleteMany.mockResolvedValue({ count: 1 });
      expect(await service.resetLayout(USER)).toEqual({ reset: true });
      expect(mockPrisma.userWorkspaceLayout.deleteMany).toHaveBeenCalledWith({
        where: { userId: USER.id },
      });
    });
  });

  describe('getAgenda', () => {
    it('unifica vencimentos, términos de OP e lembretes ordenados por data', async () => {
      const d = (s: string) => new Date(s);
      mockPrisma.financialEntry.findMany.mockResolvedValue([
        {
          id: 'f1',
          type: 'PAYABLE',
          amount: 900,
          description: 'Aluguel',
          dueDate: d('2026-08-03T12:00:00Z'),
        },
      ]);
      mockPrisma.productionOrder.findMany.mockResolvedValue([
        { id: 'op1', scheduledEnd: d('2026-08-01T12:00:00Z'), product: { name: 'Reboque 2E' } },
      ]);
      mockPrisma.leadReminder.findMany.mockResolvedValue([
        { id: 'r1', dueAt: d('2026-08-05T12:00:00Z'), text: 'Retornar', lead: { name: 'Cliente Z' } },
      ]);

      const items = await service.getAgenda(USER);
      expect(items.map((i) => i.kind)).toEqual(['production-end', 'finance-due', 'crm-reminder']);
      expect(items[0].title).toContain('Reboque 2E');
      expect(items[1].title).toContain('Aluguel');
      expect(items[1].href).toBe('/app/finance/payables');
      expect(items[1].amount).toBe(900); // estruturado p/ rollup do calendário
      expect(items[0].amount).toBeUndefined();
    });

    it('curadoria por permissão: sem finance.entries.view não consulta financeiro', async () => {
      grant(['production.orders.view']);
      await service.getAgenda(USER);
      expect(mockPrisma.financialEntry.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.productionOrder.findMany).toHaveBeenCalled();
    });

    it('janela larga (?days) amplia o limite e os takes; clamp em 42 dias', async () => {
      await service.getAgenda(USER, 35);
      expect(mockPrisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );

      // clamp: pedir 90 dias não passa de 42
      mockPrisma.financialEntry.findMany.mockClear();
      await service.getAgenda(USER, 90);
      const arg = mockPrisma.financialEntry.findMany.mock.calls[0][0];
      const to: Date = arg.where.dueDate.lte;
      const maxTo = new Date();
      maxTo.setDate(maxTo.getDate() + 43);
      expect(to.getTime()).toBeLessThan(maxTo.getTime());
    });

    it('janela default (7 dias) mantém os takes originais', async () => {
      await service.getAgenda(USER);
      expect(mockPrisma.financialEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });
});
