import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProposalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { BillingService } from './billing.service';
import { PlansService } from './plans.service';
import { ProposalsService } from './proposals.service';

/**
 * AVECCHI P2 (#963) — proposta comercial → assinatura.
 * Contratos: tabela por default (negociado é desvio explícito); aceite
 * compõe upsertSubscription + assignPlan (sem digitação dupla); decidida é
 * imutável; vencida expira no toque.
 */

const mockPrisma = {
  company: { findUnique: jest.fn() },
  plan: { findUnique: jest.fn() },
  subscriptionProposal: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};
const mockAudit = { persist: jest.fn() };
const mockBilling = { upsertSubscription: jest.fn() };
const mockPlans = { assignPlan: jest.fn() };

const ctx = { userId: 'op-1', actorCompanyId: 'avecchi' } as any;
const ROOT = { id: 't1', parentId: null };
const PLANO = { id: 'p1', code: 'PROFISSIONAL', active: true, priceCents: 99700 };

describe('ProposalsService (#963)', () => {
  let service: ProposalsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProposalsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: BillingService, useValue: mockBilling },
        { provide: PlansService, useValue: mockPlans },
      ],
    }).compile();
    service = module.get(ProposalsService);
    jest.clearAllMocks();
    mockPrisma.company.findUnique.mockResolvedValue(ROOT);
    mockPrisma.plan.findUnique.mockResolvedValue(PLANO);
    mockPrisma.subscriptionProposal.create.mockImplementation(async ({ data }: any) => ({ id: 'prop-1', ...data }));
    mockPrisma.subscriptionProposal.update.mockImplementation(async ({ data }: any) => ({ id: 'prop-1', ...data }));
    mockAudit.persist.mockResolvedValue(undefined);
  });

  it('sem priceCents → preço de TABELA do plano (modelo de mercado)', async () => {
    const p = await service.create('t1', { planId: 'p1' }, ctx);
    expect(p.priceCents).toBe(99700);
    expect(p.billingDay).toBe(5);
  });

  it('priceCents presente → valor NEGOCIADO (desvio auditado)', async () => {
    await service.create('t1', { planId: 'p1', priceCents: 89700 }, ctx);
    expect(mockPrisma.subscriptionProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ priceCents: 89700 }) }),
    );
    expect(mockAudit.persist).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: expect.objectContaining({ negociado: true }) }),
    );
  });

  it('plano sem tabela e sem valor na proposta → 400 (nunca R$ 0 implícito)', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue({ ...PLANO, priceCents: null });
    await expect(service.create('t1', { planId: 'p1' }, ctx)).rejects.toThrow(BadRequestException);
  });

  it('aceite converte SEM digitação dupla: upsertSubscription + assignPlan', async () => {
    mockPrisma.subscriptionProposal.findUnique.mockResolvedValue({
      id: 'prop-1', companyId: 't1', planId: 'p1', priceCents: 89700, billingDay: 10,
      status: ProposalStatus.SENT, validUntil: null,
    });
    await service.accept('prop-1', 'fechado na call', ctx);
    expect(mockBilling.upsertSubscription).toHaveBeenCalledWith(
      't1', { planId: 'p1', priceCents: 89700, billingDay: 10 }, ctx,
    );
    expect(mockPlans.assignPlan).toHaveBeenCalledWith('t1', 'p1', ctx);
  });

  it('proposta decidida é imutável — aceite repetido rejeita', async () => {
    mockPrisma.subscriptionProposal.findUnique.mockResolvedValue({
      id: 'prop-1', companyId: 't1', status: ProposalStatus.ACCEPTED, validUntil: null,
    });
    await expect(service.accept('prop-1', undefined, ctx)).rejects.toThrow(/imutável/);
    expect(mockBilling.upsertSubscription).not.toHaveBeenCalled();
  });

  it('vencida expira no toque e rejeita o aceite', async () => {
    mockPrisma.subscriptionProposal.findUnique.mockResolvedValue({
      id: 'prop-1', companyId: 't1', status: ProposalStatus.SENT,
      validUntil: new Date(Date.now() - 1000),
    });
    await expect(service.accept('prop-1', undefined, ctx)).rejects.toThrow(/vencida/);
    expect(mockPrisma.subscriptionProposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ProposalStatus.EXPIRED } }),
    );
  });

  it('recusa exige motivo (mín. 5)', async () => {
    await expect(service.decline('prop-1', 'ok', ctx)).rejects.toThrow(/motivo/);
  });
});
