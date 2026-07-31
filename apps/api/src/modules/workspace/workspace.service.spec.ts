import { Test, TestingModule } from '@nestjs/testing';
import { AlertSeverity, AlertType } from '@prisma/client';
import { WorkspaceService } from './workspace.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PermissionService } from '../iam/permission.service';
import { ApprovalService } from '../approval/approval.service';

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
];

const mockPrisma = {
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
    mockPrisma.inspection.count.mockResolvedValue(0);
    mockPrisma.inspection.findMany.mockResolvedValue([]);
    mockPrisma.alert.findMany.mockResolvedValue([]);
    mockPrisma.leadReminder.findMany.mockResolvedValue([]);
    mockApprovalService.getPending.mockResolvedValue([]);
    grant(ALL_PERMS);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PermissionService, useValue: mockPermissionService },
        { provide: ApprovalService, useValue: mockApprovalService },
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
      expect(tasks.map((t) => t.type)).toEqual(['crm-reminder', 'approval', 'quality-inspection']);
      expect(tasks[0].title).toBe('Follow-up: Cliente Y');
      expect(tasks[1].subtitle).toContain('Fornecedor X');
      expect(tasks[1].href).toBe('/app/approvals');
      // Só o lembrete de CRM é concluível no clique; aprovação/inspeção não.
      expect(tasks[0].complete).toEqual({ url: '/crm/reminders/rem1/done' });
      expect(tasks[1].complete).toBeUndefined();
      expect(tasks[2].complete).toBeUndefined();
    });

    it('sem permissão de aprovações: getPending não é chamado', async () => {
      grant(['crm.leads.view']);
      await service.getTasks(USER);
      expect(mockApprovalService.getPending).not.toHaveBeenCalled();
      expect(mockPrisma.inspection.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.leadReminder.findMany).toHaveBeenCalled();
    });

    it('lembretes são sempre do PRÓPRIO usuário (userId no where)', async () => {
      await service.getTasks(USER);
      const where = mockPrisma.leadReminder.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe(USER.id);
      expect(where.companyId).toBe(USER.companyId);
      expect(where.doneAt).toBeNull();
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
