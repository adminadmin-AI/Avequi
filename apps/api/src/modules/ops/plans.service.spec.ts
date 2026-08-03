import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { EntitlementService } from '../entitlement/entitlement.service';
import { PlansService } from './plans.service';

/**
 * OPS WP4 (#911) — gestão de planos/exceções.
 * Contratos: escrita valida contra o catálogo; plano/override sempre audita
 * SÍNCRONO e invalida o cache; troca de plano só em tenant RAIZ; override
 * exige reason.
 */

const mockPrisma = {
  plan: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  company: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  tenantEntitlementOverride: {
    upsert: jest.fn(),
    delete: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
};
const mockAudit = { persist: jest.fn() };
const mockEntitlement = { invalidate: jest.fn(), resolve: jest.fn() };

const CTX = {
  userId: 'op-1',
  actorCompanyId: 'avecchi-co',
  sessionId: 's1',
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
};

describe('PlansService (OPS WP4 #911)', () => {
  let service: PlansService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: EntitlementService, useValue: mockEntitlement },
      ],
    }).compile();
    service = module.get(PlansService);
    jest.clearAllMocks();
    mockAudit.persist.mockResolvedValue(undefined);
  });

  describe('createPlan', () => {
    it('entitlements com key fora do catálogo → 400, nada criado', async () => {
      await expect(
        service.createPlan(
          { code: 'X', name: 'X', entitlements: { moduloFantasma: true } },
          CTX,
        ),
      ).rejects.toThrow(/key desconhecida/);
      expect(mockPrisma.plan.create).not.toHaveBeenCalled();
    });

    it('válido → cria e audita na company do OPERADOR (plano é objeto global)', async () => {
      mockPrisma.plan.create.mockResolvedValue({ id: 'plan-1', code: 'NOVO' });
      await service.createPlan(
        { code: 'novo', name: 'Novo', entitlements: { crm: true, maxUsers: 5 } },
        CTX,
      );
      expect(mockPrisma.plan.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ code: 'NOVO' }) }),
      );
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'avecchi-co',
          entity: 'Plan',
          action: AuditAction.CREATE,
          module: 'ops',
        }),
      );
    });
  });

  describe('updatePlan', () => {
    it('edição invalida o cache de TODOS os tenants no plano', async () => {
      mockPrisma.plan.findUnique.mockResolvedValue({
        id: 'plan-1',
        entitlements: {},
        active: true,
      });
      mockPrisma.plan.update.mockResolvedValue({
        id: 'plan-1',
        entitlements: { crm: true },
        active: true,
      });
      mockPrisma.company.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);

      await service.updatePlan('plan-1', { entitlements: { crm: true } }, CTX);

      expect(mockEntitlement.invalidate).toHaveBeenCalledWith('t1');
      expect(mockEntitlement.invalidate).toHaveBeenCalledWith('t2');
      expect(mockAudit.persist).toHaveBeenCalled();
    });
  });

  describe('assignPlan', () => {
    it('filial → 404 (plano é da raiz)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'f1',
        parentId: 'root-1',
        planId: null,
        plan: null,
      });
      await expect(service.assignPlan('f1', 'plan-1', CTX)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('plano inativo → 400', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'root-1',
        parentId: null,
        planId: null,
        plan: null,
      });
      mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', active: false });
      await expect(service.assignPlan('root-1', 'plan-1', CTX)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('troca válida → audita na company do TENANT e invalida o cache dele', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'root-1',
        parentId: null,
        planId: null,
        plan: null,
      });
      mockPrisma.plan.findUnique.mockResolvedValue({
        id: 'plan-1',
        code: 'INDUSTRIAL',
        active: true,
      });
      mockPrisma.company.update.mockResolvedValue({ id: 'root-1' });

      await service.assignPlan('root-1', 'plan-1', CTX);

      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'root-1',
          oldValue: { plan: null },
          newValue: { plan: 'INDUSTRIAL' },
        }),
      );
      expect(mockEntitlement.invalidate).toHaveBeenCalledWith('root-1');
    });
  });

  describe('overrides', () => {
    beforeEach(() => {
      mockPrisma.company.findUnique.mockResolvedValue({ parentId: null });
    });

    it('sem reason → 400', async () => {
      await expect(
        service.setOverride('root-1', 'crm', true, '  ', CTX),
      ).rejects.toThrow(/motivo/);
      expect(mockPrisma.tenantEntitlementOverride.upsert).not.toHaveBeenCalled();
    });

    it('valor incompatível com o tipo da key → 400', async () => {
      await expect(
        service.setOverride('root-1', 'crm', 123, 'motivo válido', CTX),
      ).rejects.toThrow(/boolean/);
    });

    it('override válido → upsert + audit + invalidate', async () => {
      mockPrisma.tenantEntitlementOverride.upsert.mockResolvedValue({});
      await service.setOverride('root-1', 'renave', true, 'Piloto comercial autorizado', CTX);
      expect(mockPrisma.tenantEntitlementOverride.upsert).toHaveBeenCalled();
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: 'root-1', entity: 'TenantEntitlementOverride' }),
      );
      expect(mockEntitlement.invalidate).toHaveBeenCalledWith('root-1');
    });

    it('remover override inexistente → 404', async () => {
      mockPrisma.tenantEntitlementOverride.findUnique.mockResolvedValue(null);
      await expect(service.removeOverride('root-1', 'crm', CTX)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
