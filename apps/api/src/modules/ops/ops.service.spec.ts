import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditAction,
  SessionRevokedReason,
  TenantStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../iam/audit.service';
import { SessionService } from '../iam/session.service';
import { OpsService } from './ops.service';

/**
 * OPS WP1 (#908) — administração de tenants pela operadora.
 * Contratos: só a RAIZ tem lifecycle; suspensão exige motivo, audita SÍNCRONO
 * e revoga as sessões do tenant inteiro (matriz + filiais).
 */

const mockPrisma = {
  company: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  user: { findMany: jest.fn() },
};

const mockAuditService = { persist: jest.fn(), log: jest.fn() };
const mockSessionService = { revokeAllSessions: jest.fn() };

const ROOT = {
  id: 'root-1',
  name: 'GDR',
  parentId: null,
  tenantStatus: TenantStatus.ACTIVE,
  suspendedAt: null,
  suspendReason: null,
  isSandbox: false,
};

const CTX = {
  userId: 'operator-1',
  sessionId: 'sess-1',
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
};

describe('OpsService (OPS WP1 #908)', () => {
  let service: OpsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: SessionService, useValue: mockSessionService },
      ],
    }).compile();
    service = module.get(OpsService);
    jest.clearAllMocks();
    mockAuditService.persist.mockResolvedValue(undefined);
    mockSessionService.revokeAllSessions.mockResolvedValue(2);
    mockPrisma.company.update.mockResolvedValue({ id: 'root-1' });
  });

  describe('listTenants', () => {
    it('lista SOMENTE empresas raiz (parentId null)', async () => {
      mockPrisma.company.findMany.mockResolvedValue([]);
      await service.listTenants();
      expect(mockPrisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentId: null } }),
      );
    });
  });

  describe('getTenant', () => {
    it('filial → 404 (mesma resposta de id inexistente)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        id: 'filial-1',
        parentId: 'root-1',
        branches: [],
      });
      await expect(service.getTenant('filial-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('id inexistente → 404', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(null);
      await expect(service.getTenant('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTenantStatus', () => {
    it('filial → 404 (lifecycle é da raiz)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        ...ROOT,
        id: 'filial-1',
        parentId: 'root-1',
      });
      await expect(
        service.updateTenantStatus(
          'filial-1',
          { status: TenantStatus.SUSPENDED, reason: 'teste' },
          CTX,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('mesmo status → 400 (no-op não gera trilha falsa)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(ROOT);
      await expect(
        service.updateTenantStatus('root-1', { status: TenantStatus.ACTIVE }, CTX),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([[TenantStatus.SUSPENDED], [TenantStatus.CHURNED]])(
      '%s sem reason → 400',
      async (status) => {
        mockPrisma.company.findUnique.mockResolvedValue(ROOT);
        await expect(
          service.updateTenantStatus('root-1', { status }, CTX),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.company.update).not.toHaveBeenCalled();
      },
    );

    it('SUSPENDED com reason: atualiza, audita SÍNCRONO e revoga sessões da árvore', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(ROOT);
      mockPrisma.company.findMany.mockResolvedValue([
        { id: 'root-1' },
        { id: 'filial-1' },
      ]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      await service.updateTenantStatus(
        'root-1',
        { status: TenantStatus.SUSPENDED, reason: 'Inadimplência 30d' },
        CTX,
      );

      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'root-1' },
          data: expect.objectContaining({
            tenantStatus: TenantStatus.SUSPENDED,
            suspendReason: 'Inadimplência 30d',
            suspendedAt: expect.any(Date),
            isSandbox: false,
          }),
        }),
      );
      expect(mockAuditService.persist).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: 'root-1',
          userId: 'operator-1',
          entity: 'Company',
          action: AuditAction.UPDATE,
          module: 'ops',
          ipAddress: '10.0.0.1',
        }),
      );
      // usuários da matriz E da filial
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { companyId: { in: ['root-1', 'filial-1'] } },
        }),
      );
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledTimes(2);
      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledWith(
        'u1',
        SessionRevokedReason.ADMIN_REVOKE,
      );
    });

    it('reativação (SUSPENDED → ACTIVE): limpa suspensão e NÃO revoga sessões', async () => {
      mockPrisma.company.findUnique.mockResolvedValue({
        ...ROOT,
        tenantStatus: TenantStatus.SUSPENDED,
        suspendReason: 'Inadimplência',
      });

      await service.updateTenantStatus(
        'root-1',
        { status: TenantStatus.ACTIVE },
        CTX,
      );

      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantStatus: TenantStatus.ACTIVE,
            suspendedAt: null,
            suspendReason: null,
          }),
        }),
      );
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
      expect(mockAuditService.persist).toHaveBeenCalled();
    });

    it('SANDBOX: marca isSandbox=true (espelho para métricas) sem revogar sessões', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(ROOT);

      await service.updateTenantStatus(
        'root-1',
        { status: TenantStatus.SANDBOX },
        CTX,
      );

      expect(mockPrisma.company.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantStatus: TenantStatus.SANDBOX,
            isSandbox: true,
          }),
        }),
      );
      expect(mockSessionService.revokeAllSessions).not.toHaveBeenCalled();
    });

    it('falha na revogação de UM usuário não impede os demais (best-effort)', async () => {
      mockPrisma.company.findUnique.mockResolvedValue(ROOT);
      mockPrisma.company.findMany.mockResolvedValue([{ id: 'root-1' }]);
      mockPrisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      mockSessionService.revokeAllSessions
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce(3);

      await service.updateTenantStatus(
        'root-1',
        { status: TenantStatus.SUSPENDED, reason: 'Encerramento de contrato' },
        CTX,
      );

      expect(mockSessionService.revokeAllSessions).toHaveBeenCalledTimes(2);
    });
  });
});
