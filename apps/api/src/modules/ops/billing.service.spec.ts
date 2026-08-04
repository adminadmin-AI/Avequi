import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, InvoiceStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { MailService } from '../mail/mail.service';
import {
  BillingService,
  DUNNING,
  dueDateOf,
  periodOf,
} from './billing.service';

/**
 * OPS WP5 (#912) — billing F1.
 * Contratos: fatura única por (tenant, competência) — idempotente; SANDBOX e
 * CHURNED nunca faturam; e-mail D+3 sai UMA vez (e SMTP fora retenta amanhã);
 * baixa/anulação auditadas e só de OPEN/OVERDUE; aging por faixas; status do
 * tenant escala none → notice (D+3) → banner (D+10).
 */

const mockPrisma = {
  subscription: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  invoice: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  company: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn() },
  financialEntry: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  user: { findMany: jest.fn() },
};
const mockAudit = { persist: jest.fn() };
const mockMail = { send: jest.fn() };

const CTX = {
  userId: 'op-1',
  actorCompanyId: 'avecchi-co',
  sessionId: 's1',
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
};

const NOW = new Date('2026-08-15T12:00:00Z');

describe('BillingService (OPS WP5 #912)', () => {
  let service: BillingService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: MailService, useValue: mockMail },
      ],
    }).compile();
    service = module.get(BillingService);
    jest.clearAllMocks();
    mockAudit.persist.mockResolvedValue(undefined);
    mockMail.send.mockResolvedValue({ ok: true });
    mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.invoice.findMany.mockResolvedValue([]);
  });

  describe('periodOf / dueDateOf', () => {
    it('competência é o dia 1 do mês UTC; vencimento é o billingDay do mês', () => {
      const p = periodOf(NOW);
      expect(p.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(dueDateOf(p, 10).toISOString()).toBe('2026-08-10T00:00:00.000Z');
    });
  });

  describe('generateInvoices', () => {
    it('gera a fatura da competência corrente com vencimento no billingDay', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { companyId: 'root-1', priceCents: 149900, billingDay: 10 },
      ]);
      mockPrisma.invoice.findUnique.mockResolvedValue(null);
      mockPrisma.invoice.create.mockResolvedValue({ id: 'inv-1' });

      const created = await service.generateInvoices(NOW);

      expect(created).toBe(1);
      expect(mockPrisma.invoice.create).toHaveBeenCalledWith({
        data: {
          companyId: 'root-1',
          period: new Date('2026-08-01T00:00:00.000Z'),
          amountCents: 149900,
          dueDate: new Date('2026-08-10T00:00:00.000Z'),
        },
      });
    });

    it('idempotente: fatura da competência já existe → não duplica', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { companyId: 'root-1', priceCents: 149900, billingDay: 10 },
      ]);
      mockPrisma.invoice.findUnique.mockResolvedValue({ id: 'inv-ja-existe' });

      const created = await service.generateInvoices(NOW);

      expect(created).toBe(0);
      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('exclui SANDBOX e CHURNED na consulta de assinaturas', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      await service.generateInvoices(NOW);
      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            canceledAt: null,
            company: expect.objectContaining({
              isSandbox: false,
              tenantStatus: { notIn: [TenantStatus.CHURNED] },
            }),
          }),
        }),
      );
    });
  });

  describe('runDunning', () => {
    it('marca OPEN vencida como OVERDUE', async () => {
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 2 });
      const result = await service.runDunning(NOW);
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { status: InvoiceStatus.OPEN, dueDate: { lt: NOW } },
        data: { status: InvoiceStatus.OVERDUE },
      });
      expect(result.overdueMarked).toBe(2);
    });

    it('e-mail D+3: envia UMA vez (marca notifiedAt) pros contatos do tenant', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          amountCents: 149900,
          dueDate: new Date('2026-08-10T00:00:00Z'),
          company: { id: 'root-1', name: 'CRD', email: 'contato@crd.com.br' },
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ email: 'maria@crd.com.br' }]);
      mockPrisma.invoice.update.mockResolvedValue({});

      const result = await service.runDunning(NOW);

      expect(result.emailsSent).toBe(1);
      const mail = mockMail.send.mock.calls[0][0];
      expect(mail.to).toContain('contato@crd.com.br');
      expect(mail.to).toContain('maria@crd.com.br');
      expect(mockPrisma.invoice.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { notifiedAt: NOW },
      });
    });

    it('SMTP fora: NÃO marca notifiedAt (retenta amanhã)', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          amountCents: 100,
          dueDate: new Date('2026-08-10T00:00:00Z'),
          company: { id: 'root-1', name: 'CRD', email: 'contato@crd.com.br' },
        },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockMail.send.mockResolvedValue({ ok: false, reason: 'SMTP down' });

      const result = await service.runDunning(NOW);

      expect(result.emailsSent).toBe(0);
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe('markPaid / voidInvoice', () => {
    it('baixa manual: OPEN→PAID com método válido + audit APPROVE', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        companyId: 'root-1',
        status: InvoiceStatus.OVERDUE,
      });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID });

      await service.markPaid('inv-1', 'PIX', CTX);

      expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: InvoiceStatus.PAID, method: 'PIX' }),
        }),
      );
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'root-1', action: AuditAction.APPROVE, module: 'ops' }),
      );
    });

    it('método inválido → 400 sem tocar a fatura', async () => {
      await expect(service.markPaid('inv-1', 'DINHEIRO_VIVO', CTX)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrisma.invoice.update).not.toHaveBeenCalled();
    });

    it('fatura já PAID → 400', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        companyId: 'root-1',
        status: InvoiceStatus.PAID,
      });
      await expect(service.markPaid('inv-1', 'PIX', CTX)).rejects.toThrow(/já está/);
    });

    it('void sem motivo → 400; com motivo → VOID + audit CANCEL', async () => {
      await expect(service.voidInvoice('inv-1', ' ', CTX)).rejects.toThrow(/motivo/);

      mockPrisma.invoice.findUnique.mockResolvedValue({
        id: 'inv-1',
        companyId: 'root-1',
        status: InvoiceStatus.OPEN,
      });
      mockPrisma.invoice.update.mockResolvedValue({});
      await service.voidInvoice('inv-1', 'Emitida em duplicidade', CTX);
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CANCEL }),
      );
    });
  });

  describe('subscription', () => {
    it('filial → 404 (assinatura é da raiz)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ parentId: 'root-1' });
      await expect(
        service.upsertSubscription('f1', { priceCents: 1000, billingDay: 5 }, CTX),
      ).rejects.toThrow(NotFoundException);
    });

    it('cria assinatura nova com createdById do operador e audita', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ parentId: null });
      mockPrisma.subscription.findUnique.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue({ id: 'sub-1' });

      await service.upsertSubscription('root-1', { priceCents: 149900, billingDay: 10 }, CTX);

      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'root-1', createdById: 'op-1' }),
        }),
      );
      expect(mockAudit.persist).toHaveBeenCalled();
    });

    it('cancelar sem assinatura ativa → 400', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({ parentId: null });
      mockPrisma.subscription.findUnique.mockResolvedValue(null);
      await expect(service.cancelSubscription('root-1', CTX)).rejects.toThrow(/sem assinatura/);
    });
  });

  describe('ponte billing→financeiro (AVECCHI P1 #960)', () => {
    const OP = 'op-avecchi';
    const FATURA = {
      id: 'inv-1',
      companyId: 'gdr',
      financialEntryId: null,
      amountCents: 150000,
      dueDate: new Date('2026-08-10'),
      period: new Date(Date.UTC(2026, 7, 1)),
      status: 'OPEN',
      company: { name: 'GDR Reboques' },
    };
    beforeEach(() => {
      process.env.OPERADORA_COMPANY_ID = OP;
    });
    afterEach(() => {
      delete process.env.OPERADORA_COMPANY_ID;
    });

    it('fatura órfã vira título RECEIVABLE no tenant da operadora e é ligada', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1' }]);
      mockPrisma.invoice.findUnique.mockResolvedValue(FATURA);
      mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-1' });
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      expect(await service.bridgeOrphanInvoices()).toBe(1);
      expect(mockPrisma.financialEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: OP,
          type: 'RECEIVABLE',
          status: 'OPEN',
          amount: '1500.00',
          documentNumber: 'inv-1',
          source: 'MANUAL',
          description: 'Mensalidade GDR Reboques — competência 08/2026',
        }),
      });
      expect(mockPrisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { id: 'inv-1', financialEntryId: null },
        data: { financialEntryId: 'fe-1' },
      });
    });

    it('sem OPERADORA_COMPANY_ID a ponte é no-op (deploy-safe)', async () => {
      delete process.env.OPERADORA_COMPANY_ID;
      expect(await service.bridgeOrphanInvoices()).toBe(0);
      expect(mockPrisma.financialEntry.create).not.toHaveBeenCalled();
    });

    it('corrida no link (updateMany=0) remove o título excedente', async () => {
      mockPrisma.invoice.findMany.mockResolvedValue([{ id: 'inv-1' }]);
      mockPrisma.invoice.findUnique.mockResolvedValue(FATURA);
      mockPrisma.financialEntry.create.mockResolvedValue({ id: 'fe-dup' });
      mockPrisma.invoice.updateMany.mockResolvedValue({ count: 0 });

      expect(await service.bridgeOrphanInvoices()).toBe(0);
      expect(mockPrisma.financialEntry.delete).toHaveBeenCalledWith({ where: { id: 'fe-dup' } });
    });

    it('baixa da fatura propaga PAID ao título (TRANSFER vira TED)', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', companyId: 'gdr', status: 'OPEN' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'PAID' });
      mockPrisma.invoice.findUnique.mockResolvedValue({ financialEntryId: 'fe-1' });

      await service.markPaid('inv-1', 'TRANSFER', { actorId: 'u1' } as any);
      expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith({
        where: { id: 'fe-1' },
        data: { status: 'PAID', paymentMethod: 'TED' },
      });
    });

    it('anulação propaga CANCELLED ao título', async () => {
      mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'inv-1', companyId: 'gdr', status: 'OPEN' });
      mockPrisma.invoice.update.mockResolvedValue({ id: 'inv-1', status: 'VOID' });
      mockPrisma.invoice.findUnique.mockResolvedValue({ financialEntryId: 'fe-1' });

      await service.voidInvoice('inv-1', 'emitida em duplicidade', { actorId: 'u1' } as any);
      expect(mockPrisma.financialEntry.update).toHaveBeenCalledWith({
        where: { id: 'fe-1' },
        data: { status: 'CANCELLED' },
      });
    });
  });

  describe('overview', () => {
    it('MRR por plano (LEGADO quando sem plano) + aging por faixas', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { priceCents: 100000, company: { id: 't1', name: 'GDR', plan: { code: 'INDUSTRIAL' } } },
        { priceCents: 50000, company: { id: 't2', name: 'CRD', plan: null } },
      ]);
      jest.useFakeTimers().setSystemTime(NOW);
      mockPrisma.invoice.findMany.mockResolvedValue([
        // a vencer
        { id: 'i1', amountCents: 100, dueDate: new Date('2026-08-20'), status: 'OPEN', period: new Date(), company: { id: 't1', name: 'GDR' } },
        // 5 dias vencida
        { id: 'i2', amountCents: 200, dueDate: new Date('2026-08-10'), status: 'OVERDUE', period: new Date(), company: { id: 't2', name: 'CRD' } },
        // 45 dias vencida
        { id: 'i3', amountCents: 400, dueDate: new Date('2026-07-01'), status: 'OVERDUE', period: new Date(), company: { id: 't2', name: 'CRD' } },
      ]);

      const o = await service.overview();
      jest.useRealTimers();

      expect(o.mrrCents).toBe(150000);
      expect(o.mrrByPlan).toEqual({ INDUSTRIAL: 100000, LEGADO: 50000 });
      expect(o.aging).toEqual({ current: 100, d1_15: 200, d16_30: 0, d31_plus: 400 });
    });

    // Painel da Operadora (#957)
    it('newMrrMonthCents conta só assinaturas criadas na competência corrente', async () => {
      jest.useFakeTimers().setSystemTime(NOW); // 2026-08-15
      mockPrisma.subscription.findMany.mockResolvedValue([
        { priceCents: 100000, createdAt: new Date('2026-08-02'), company: { id: 't1', name: 'GDR', plan: null } },
        { priceCents: 50000, createdAt: new Date('2026-06-10'), company: { id: 't2', name: 'CRD', plan: null } },
      ]);
      mockPrisma.invoice.findMany.mockResolvedValue([]);

      const o = await service.overview();
      jest.useRealTimers();

      expect(o.newMrrMonthCents).toBe(100000); // só a de agosto
      expect(o.mrrCents).toBe(150000); // MRR total não muda
    });

    it('billedSeries: 6 competências, mês sem fatura = zero (série honesta), VOID fora do filtro', async () => {
      jest.useFakeTimers().setSystemTime(NOW); // 2026-08-15
      mockPrisma.subscription.findMany.mockResolvedValue([]);
      // 1ª chamada (série) e 2ª (abertas) usam o mesmo mock — sem faturas
      // abertas o resultado da 2ª é ignorado pelo aging.
      mockPrisma.invoice.findMany
        .mockResolvedValueOnce([
          { period: new Date(Date.UTC(2026, 7, 1)), amountCents: 300 },
          { period: new Date(Date.UTC(2026, 7, 1)), amountCents: 200 },
          { period: new Date(Date.UTC(2026, 5, 1)), amountCents: 100 },
        ])
        .mockResolvedValueOnce([]);

      const o = await service.overview();
      jest.useRealTimers();

      expect(o.billedSeries).toEqual([
        { period: '2026-03', amountCents: 0 },
        { period: '2026-04', amountCents: 0 },
        { period: '2026-05', amountCents: 0 },
        { period: '2026-06', amountCents: 100 },
        { period: '2026-07', amountCents: 0 },
        { period: '2026-08', amountCents: 500 }, // soma da competência
      ]);
      // filtro da série exclui VOID e recorta as 6 competências
      const where = mockPrisma.invoice.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({ not: 'VOID' });
      expect(where.period.gte).toEqual(new Date(Date.UTC(2026, 2, 1)));
    });
  });

  describe('myBillingStatus', () => {
    function mockWorst(daysPastDue: number | null) {
      mockPrisma.company.findUniqueOrThrow.mockResolvedValue({ id: 'f1', parentId: 'root-1' });
      mockPrisma.invoice.findFirst.mockResolvedValue(
        daysPastDue === null
          ? null
          : {
              dueDate: new Date(Date.now() - daysPastDue * 24 * 3600 * 1000),
              amountCents: 1000,
            },
      );
    }

    it('sem OVERDUE → none', async () => {
      mockWorst(null);
      expect((await service.myBillingStatus('f1')).level).toBe('none');
    });

    it('vencida há 1 dia (antes do D+3) → none (ainda sem régua)', async () => {
      mockWorst(1);
      expect((await service.myBillingStatus('f1')).level).toBe('none');
    });

    it(`D+${DUNNING.EMAIL_DIAS} → notice`, async () => {
      mockWorst(DUNNING.EMAIL_DIAS + 1);
      expect((await service.myBillingStatus('f1')).level).toBe('notice');
    });

    it(`D+${DUNNING.BANNER_DIAS} → banner persistente`, async () => {
      mockWorst(DUNNING.BANNER_DIAS + 1);
      const status = await service.myBillingStatus('f1');
      expect(status.level).toBe('banner');
      expect(status.message).toMatch(/suspensão/);
    });

    it('resolve pela RAIZ (usuário de filial vê o status do tenant)', async () => {
      mockWorst(null);
      await service.myBillingStatus('f1');
      expect(mockPrisma.invoice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'root-1' }) }),
      );
    });
  });
});
