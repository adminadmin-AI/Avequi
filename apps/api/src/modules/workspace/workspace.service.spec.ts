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
    });

    it('curadoria por permissão: sem finance.entries.view não consulta financeiro', async () => {
      grant(['production.orders.view']);
      await service.getAgenda(USER);
      expect(mockPrisma.financialEntry.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.productionOrder.findMany).toHaveBeenCalled();
    });
  });
});
