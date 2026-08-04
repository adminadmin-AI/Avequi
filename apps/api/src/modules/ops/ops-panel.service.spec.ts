import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ALERT_RULES, OpsPanelService } from './ops-panel.service';

/**
 * OPS WP3 (#910) — leituras do painel.
 * Contratos: drill-down só em raiz; alertas excluem SANDBOX/CHURNED e
 * disparam nas 4 regras (sem login, pico 5xx, rejeição SEFAZ, trial vencendo).
 */

const mockPrisma = {
  company: { findMany: jest.fn(), findUnique: jest.fn() },
  invoice: { findMany: jest.fn() },
  tenantUsageDaily: { findMany: jest.fn(), groupBy: jest.fn() },
  userSession: { findMany: jest.fn(), groupBy: jest.fn() },
  fiscalDocument: { findMany: jest.fn() },
  supportIncident: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  auditLogV2: { findMany: jest.fn() },
};

const ROOT = {
  id: 'root-1',
  name: 'GDR',
  parentId: null,
  branches: [{ id: 'filial-1' }],
};

describe('OpsPanelService — getPortfolioKpis (Painel da Operadora #957)', () => {
  let service: OpsPanelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpsPanelService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get(OpsPanelService);
    jest.clearAllMocks();
  });

  it('conta por status, sandbox separado e novas do mês (raiz apenas)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'));
    mockPrisma.company.findMany.mockResolvedValue([
      { tenantStatus: TenantStatus.ACTIVE, isSandbox: false, createdAt: new Date('2026-06-01') },
      { tenantStatus: TenantStatus.ACTIVE, isSandbox: false, createdAt: new Date('2026-08-03') }, // nova no mês
      { tenantStatus: TenantStatus.TRIAL, isSandbox: false, createdAt: new Date('2026-08-10') }, // nova no mês
      { tenantStatus: TenantStatus.CHURNED, isSandbox: false, createdAt: new Date('2026-01-01') },
      { tenantStatus: TenantStatus.ACTIVE, isSandbox: true, createdAt: new Date('2026-08-01') }, // sandbox: fora de tudo
    ]);

    const k = await service.getPortfolioKpis();
    jest.useRealTimers();

    expect(k.statusCounts).toEqual({ ACTIVE: 2, TRIAL: 1, CHURNED: 1 });
    expect(k.sandbox).toBe(1);
    expect(k.newTenantsMonth).toBe(2); // sandbox de agosto NÃO conta
    expect(k.totalTenants).toBe(4);
    // só tenants raiz entram na consulta
    expect(mockPrisma.company.findMany.mock.calls[0][0].where).toEqual({ parentId: null });
  });
});

describe('OpsPanelService (OPS WP3 #910)', () => {
  let service: OpsPanelService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpsPanelService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(OpsPanelService);
    jest.clearAllMocks();
    // defaults vazios
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.tenantUsageDaily.findMany.mockResolvedValue([]);
    mockPrisma.tenantUsageDaily.groupBy.mockResolvedValue([]);
    mockPrisma.userSession.findMany.mockResolvedValue([]);
    mockPrisma.userSession.groupBy.mockResolvedValue([]);
  });

  describe('getUsage', () => {
    it('filial → 404 (drill-down é da raiz)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ ...ROOT, parentId: 'x' });
      await expect(service.getUsage('filial-1')).rejects.toThrow(NotFoundException);
    });

    it('série + totais somados e pico de usuários', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(ROOT);
      mockPrisma.tenantUsageDaily.findMany.mockResolvedValue([
        { date: new Date('2026-08-01'), activeUsers: 3, nfeIssued: 2, nfeRejected: 0, crmLeads: 1, errors5xx: 0 },
        { date: new Date('2026-08-02'), activeUsers: 5, nfeIssued: 1, nfeRejected: 1, crmLeads: 0, errors5xx: 2 },
      ]);
      const result = await service.getUsage('root-1', 90);
      expect(result.series).toHaveLength(2);
      expect(result.totals).toEqual({
        nfeIssued: 3,
        nfeRejected: 1,
        crmLeads: 1,
        errors5xx: 2,
        peakActiveUsers: 5,
      });
    });
  });

  describe('getAlerts', () => {
    function tenant(overrides = {}) {
      return {
        id: 'root-1',
        name: 'GDR',
        tenantStatus: TenantStatus.ACTIVE,
        trialEndsAt: null,
        ...overrides,
      };
    }

    it('consulta exclui SANDBOX e CHURNED/SUSPENDED por filtro', async () => {
      mockPrisma.company.findMany.mockResolvedValue([]);
      await service.getAlerts();
      expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isSandbox: false,
            tenantStatus: { in: [TenantStatus.ACTIVE, TenantStatus.TRIAL] },
          }),
        }),
      );
    });

    it('sem login nunca registrado → alerta SEM_LOGIN (adoção)', async () => {
      mockPrisma.company.findMany
        .mockResolvedValueOnce([tenant()]) // getAlerts
        .mockResolvedValueOnce([{ id: 'root-1', branches: [] }]); // listUsageSummary
      const alerts = await service.getAlerts();
      expect(alerts).toEqual([
        expect.objectContaining({ type: 'SEM_LOGIN', tenantId: 'root-1' }),
      ]);
    });

    it('pico de 5xx ontem ≥ limite → alerta CRITICAL', async () => {
      mockPrisma.company.findMany
        .mockResolvedValueOnce([tenant()])
        .mockResolvedValueOnce([{ id: 'root-1', branches: [] }]);
      // login recente pra não disparar SEM_LOGIN
      mockPrisma.userSession.groupBy.mockResolvedValue([
        { companyId: 'root-1', _max: { createdAt: new Date() } },
      ]);
      mockPrisma.tenantUsageDaily.findMany.mockResolvedValue([
        { companyId: 'root-1', errors5xx: ALERT_RULES.PICO_5XX_DIA },
      ]);
      const alerts = await service.getAlerts();
      expect(alerts).toEqual([
        expect.objectContaining({ type: 'PICO_5XX', severity: 'CRITICAL' }),
      ]);
    });

    it('rejeição SEFAZ > 20% em 7d (com mínimo de docs) → alerta CRITICAL', async () => {
      mockPrisma.company.findMany
        .mockResolvedValueOnce([tenant()])
        .mockResolvedValueOnce([{ id: 'root-1', branches: [] }]);
      mockPrisma.userSession.groupBy.mockResolvedValue([
        { companyId: 'root-1', _max: { createdAt: new Date() } },
      ]);
      // Despacho pelos campos do _sum (ordem das chamadas no Promise.all não
      // é garantida): só a consulta SEFAZ pede nfeRejected.
      mockPrisma.tenantUsageDaily.groupBy.mockImplementation((args: any) =>
        Promise.resolve(
          args?._sum?.nfeRejected
            ? [{ companyId: 'root-1', _sum: { nfeIssued: 7, nfeRejected: 3 } }]
            : [],
        ),
      );
      const alerts = await service.getAlerts();
      expect(alerts).toEqual([
        expect.objectContaining({ type: 'REJEICAO_SEFAZ', severity: 'CRITICAL' }),
      ]);
    });

    it('TRIAL com trialEndsAt em < 7 dias → alerta TRIAL_VENCENDO', async () => {
      mockPrisma.company.findMany
        .mockResolvedValueOnce([
          tenant({
            tenantStatus: TenantStatus.TRIAL,
            trialEndsAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
          }),
        ])
        .mockResolvedValueOnce([{ id: 'root-1', branches: [] }]);
      mockPrisma.userSession.groupBy.mockResolvedValue([
        { companyId: 'root-1', _max: { createdAt: new Date() } },
      ]);
      const alerts = await service.getAlerts();
      expect(alerts).toEqual([
        expect.objectContaining({ type: 'TRIAL_VENCENDO', severity: 'WARNING' }),
      ]);
    });

    it('fatura OVERDUE há ≥20 dias → SUSPENSAO_PROPOSTA (CRITICAL), 1 por tenant (WP5 #912)', async () => {
      mockPrisma.company.findMany
        .mockResolvedValueOnce([tenant()])
        .mockResolvedValueOnce([{ id: 'root-1', branches: [] }]);
      mockPrisma.userSession.groupBy.mockResolvedValue([
        { companyId: 'root-1', _max: { createdAt: new Date() } },
      ]);
      mockPrisma.invoice.findMany.mockResolvedValue([
        { companyId: 'root-1', dueDate: new Date(Date.now() - 25 * 24 * 3600 * 1000), amountCents: 149900 },
        { companyId: 'root-1', dueDate: new Date(Date.now() - 55 * 24 * 3600 * 1000), amountCents: 149900 },
      ]);
      const alerts = await service.getAlerts();
      const propostas = alerts.filter((a) => a.type === 'SUSPENSAO_PROPOSTA');
      expect(propostas).toHaveLength(1);
      expect(propostas[0]).toMatchObject({ severity: 'CRITICAL', tenantId: 'root-1' });
      expect(propostas[0].message).toMatch(/decisão manual/);
    });

    it('carteira saudável → zero alertas', async () => {
      mockPrisma.company.findMany
        .mockResolvedValueOnce([tenant()])
        .mockResolvedValueOnce([{ id: 'root-1', branches: [] }]);
      mockPrisma.userSession.groupBy.mockResolvedValue([
        { companyId: 'root-1', _max: { createdAt: new Date() } },
      ]);
      const alerts = await service.getAlerts();
      expect(alerts).toEqual([]);
    });
  });

  describe('getTimeline', () => {
    it('lê AuditLogV2 do tenant filtrado por module=ops, mais recente primeiro', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(ROOT);
      mockPrisma.auditLogV2.findMany.mockResolvedValue([]);
      await service.getTimeline('root-1');
      expect(mockPrisma.auditLogV2.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: 'root-1', module: 'ops' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });
});
