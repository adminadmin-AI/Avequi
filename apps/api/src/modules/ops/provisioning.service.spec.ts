import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { ProvisioningService } from './provisioning.service';
import { TenantInviteService } from './tenant-invite.service';

/**
 * OPS WP2 (#909) — máquina de estados do onboarding.
 * Contratos: idempotência por CNPJ, fiscal-check exige token ESCOPADO
 * (fallback global = matriz GDR, #695), activate gateia por convite aceito
 * + fiscal ok, tudo auditado síncrono.
 */

const mockPrisma = {
  company: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  tenantProvisioning: { findUnique: jest.fn(), update: jest.fn() },
  tenantInvite: { findFirst: jest.fn() },
  taxRule: { createMany: jest.fn() }, // seed de regras do Simples (#1071)
};
const mockAudit = { persist: jest.fn() };
const mockInvite = { inviteAdmin: jest.fn() };
const mockConfig = { get: jest.fn() };

const CTX = { userId: 'op-1', sessionId: 's1', ipAddress: '10.0.0.1', userAgent: 'jest' };

const PROVISIONING = {
  id: 'prov-1',
  companyId: 'tenant-1',
  steps: {},
  createdById: 'op-1',
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  company: {
    id: 'tenant-1',
    name: 'CRD',
    cnpj: '12345678000199',
    razaoSocial: 'CRD LTDA',
    tenantStatus: TenantStatus.TRIAL,
    onboardedAt: null,
  },
};

describe('ProvisioningService (OPS WP2 #909)', () => {
  let service: ProvisioningService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProvisioningService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
        { provide: TenantInviteService, useValue: mockInvite },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();
    service = module.get(ProvisioningService);
    jest.clearAllMocks();
    mockAudit.persist.mockResolvedValue(undefined);
    mockConfig.get.mockReturnValue('');
  });

  describe('createTenant', () => {
    const DTO = { name: 'CRD', cnpj: '12345678000199', razaoSocial: 'CRD LTDA' } as any;

    it('cria Company raiz TRIAL + provisioning e audita CREATE', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      mockPrisma.company.create.mockResolvedValue({ id: 'tenant-1' });
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValue(PROVISIONING);

      await service.createTenant(DTO, CTX);

      expect(mockPrisma.company.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cnpj: DTO.cnpj,
            tenantStatus: TenantStatus.TRIAL,
            provisioning: { create: { createdById: 'op-1' } },
          }),
        }),
      );
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.CREATE, module: 'ops' }),
      );
    });

    // #1071: tenant do Simples nasce com regras semeadas, mas INATIVAS
    it('CRT=1 → semeia regras fiscais inativas junto com o tenant', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      mockPrisma.company.create.mockResolvedValue({ id: 'tenant-sn' });
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValue(PROVISIONING);

      await service.createTenant({ ...DTO, crt: 1 }, CTX);

      expect(mockPrisma.taxRule.createMany).toHaveBeenCalledTimes(1);
      const { data } = mockPrisma.taxRule.createMany.mock.calls[0][0];
      expect(data).toHaveLength(6);
      expect(data.every((r: any) => r.companyId === 'tenant-sn')).toBe(true);
      // a trava: ativo por engano = nota com tributação que ninguém revisou
      expect(data.every((r: any) => r.isActive === false)).toBe(true);
    });

    it('CRT=3 → não semeia nada (regime normal segue cadastro manual)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      mockPrisma.company.create.mockResolvedValue({ id: 'tenant-normal' });
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValue(PROVISIONING);

      await service.createTenant({ ...DTO, crt: 3 }, CTX);

      expect(mockPrisma.taxRule.createMany).not.toHaveBeenCalled();
    });

    it('CNPJ com provisionamento ABERTO → retoma (não duplica, não lança)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'tenant-1',
        parentId: null,
        provisioning: { id: 'prov-1', completedAt: null },
      });
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValue(PROVISIONING);

      const result = await service.createTenant(DTO, CTX);

      expect(result.id).toBe('prov-1');
      expect(mockPrisma.company.create).not.toHaveBeenCalled();
    });

    it('CNPJ de tenant já concluído → 409', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'tenant-1',
        parentId: null,
        provisioning: { id: 'prov-1', completedAt: new Date() },
      });
      await expect(service.createTenant(DTO, CTX)).rejects.toThrow(ConflictException);
    });
  });

  describe('runFiscalCheck', () => {
    beforeEach(() => {
      mockPrisma.tenantProvisioning.findUnique
        .mockResolvedValueOnce({ id: 'prov-1', completedAt: null }) // assertOpen
        .mockResolvedValue({ steps: {} }); // patchSteps read
      mockPrisma.tenantProvisioning.update.mockResolvedValue({});
    });

    it('token ESCOPADO presente → ok=true, tokenSource=scoped', async () => {
      mockConfig.get.mockImplementation((key: string) =>
        key === 'FOCUS_NFE_TOKEN__tenant-1' ? 'tok-crd' : '',
      );
      const result = await service.runFiscalCheck('tenant-1', CTX);
      expect(result).toMatchObject({ ok: true, tokenSource: 'scoped' });
    });

    it('sem token escopado → ok=false (fallback global NÃO conta — emitiria como GDR, #695)', async () => {
      mockConfig.get.mockImplementation((key: string, def?: string) =>
        key === 'FOCUS_NFE_TOKEN' ? 'token-global-gdr' : def ?? '',
      );
      const result = await service.runFiscalCheck('tenant-1', CTX);
      expect(result).toMatchObject({ ok: false, tokenSource: 'missing' });
    });
  });

  describe('activate', () => {
    function mockChecklist(opts: { accepted: boolean; fiscalOk: boolean }) {
      // assertOpenProvisioning
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValueOnce({
        id: 'prov-1',
        completedAt: null,
      });
      // getProvisioning
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValueOnce({
        ...PROVISIONING,
        steps: {
          admin: { userId: 'u-1', email: 'a@crd.com', invitedAt: 'x', emailSent: true },
          fiscal: { ok: opts.fiscalOk, tokenSource: opts.fiscalOk ? 'scoped' : 'missing', checkedAt: 'x' },
        },
      });
      mockPrisma.tenantInvite.findFirst.mockResolvedValue({
        usedAt: opts.accepted ? new Date() : null,
        expiresAt: new Date(Date.now() + 1000),
      });
    }

    it('convite não aceito → 400 com pendência nomeada', async () => {
      mockChecklist({ accepted: false, fiscalOk: true });
      await expect(service.activate('tenant-1', CTX)).rejects.toThrow(/convite/);
      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    });

    it('fiscal pendente → 400', async () => {
      mockChecklist({ accepted: true, fiscalOk: false });
      await expect(service.activate('tenant-1', CTX)).rejects.toThrow(BadRequestException);
    });

    it('tudo ok → TRIAL vira ACTIVE + onboardedAt + completedAt + audit APPROVE', async () => {
      mockChecklist({ accepted: true, fiscalOk: true });
      mockPrisma.company.update.mockResolvedValue({
        id: 'tenant-1',
        tenantStatus: TenantStatus.ACTIVE,
      });
      mockPrisma.tenantProvisioning.update.mockResolvedValue({});

      await service.activate('tenant-1', CTX);

      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantStatus: TenantStatus.ACTIVE,
            onboardedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockPrisma.tenantProvisioning.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { completedAt: expect.any(Date) },
        }),
      );
      expect(mockAudit.persist).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.APPROVE, module: 'ops' }),
      );
    });

    it('provisionamento já concluído → 400', async () => {
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValueOnce({
        id: 'prov-1',
        completedAt: new Date(),
      });
      await expect(service.activate('tenant-1', CTX)).rejects.toThrow(/concluído/);
    });

    it('tenant sem provisionamento → 404', async () => {
      mockPrisma.tenantProvisioning.findUnique.mockResolvedValueOnce(null);
      await expect(service.activate('nope', CTX)).rejects.toThrow(NotFoundException);
    });
  });
});
