import { Test, TestingModule } from '@nestjs/testing';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantStatusService } from './tenant-status.service';

/**
 * OPS WP1 (#908) — resolução do status do tenant pela empresa RAIZ.
 * Filial herda a raiz; o campo próprio da filial é ignorado de propósito.
 */

const mockPrisma = {
  company: { findUniqueOrThrow: jest.fn() },
};

const ROOT_ACTIVE = {
  id: 'root-1',
  name: 'GDR Matriz',
  tenantStatus: TenantStatus.ACTIVE,
  suspendReason: null,
  isSandbox: false,
};

describe('TenantStatusService (OPS WP1 #908)', () => {
  let service: TenantStatusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantStatusService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(TenantStatusService);
    jest.clearAllMocks();
  });

  describe('getTenantRoot', () => {
    it('empresa raiz (sem parent) resolve para ela mesma', async () => {
      mockPrisma.company.findUniqueOrThrow.mockResolvedValue({
        ...ROOT_ACTIVE,
        parent: null,
      });
      const root = await service.getTenantRoot('root-1');
      expect(root.id).toBe('root-1');
      expect(root.tenantStatus).toBe(TenantStatus.ACTIVE);
    });

    it('filial resolve para a RAIZ — status próprio da filial é ignorado', async () => {
      mockPrisma.company.findUniqueOrThrow.mockResolvedValue({
        id: 'filial-1',
        name: 'GDR Loja Cascavel',
        tenantStatus: TenantStatus.ACTIVE, // filial "ativa"...
        suspendReason: null,
        isSandbox: false,
        parent: {
          ...ROOT_ACTIVE,
          tenantStatus: TenantStatus.SUSPENDED, // ...mas a matriz suspensa
          suspendReason: 'Inadimplência',
        },
      });
      const root = await service.getTenantRoot('filial-1');
      expect(root.id).toBe('root-1');
      expect(root.tenantStatus).toBe(TenantStatus.SUSPENDED);
    });
  });

  describe('getLoginBlock', () => {
    function mockRootWithStatus(tenantStatus: TenantStatus, extra = {}) {
      mockPrisma.company.findUniqueOrThrow.mockResolvedValue({
        ...ROOT_ACTIVE,
        tenantStatus,
        parent: null,
        ...extra,
      });
    }

    it.each([
      [TenantStatus.ACTIVE],
      [TenantStatus.TRIAL],
      [TenantStatus.SANDBOX],
    ])('%s → sem bloqueio (autentica normal)', async (status) => {
      mockRootWithStatus(status);
      expect(await service.getLoginBlock('root-1')).toBeNull();
    });

    it('SUSPENDED → bloqueio com mensagem de regularização', async () => {
      mockRootWithStatus(TenantStatus.SUSPENDED);
      const block = await service.getLoginBlock('root-1');
      expect(block?.status).toBe(TenantStatus.SUSPENDED);
      expect(block?.message).toMatch(/suspenso/);
      expect(block?.message).toMatch(/Avecchi/);
    });

    it('CHURNED → bloqueio de conta encerrada', async () => {
      mockRootWithStatus(TenantStatus.CHURNED);
      const block = await service.getLoginBlock('root-1');
      expect(block?.status).toBe(TenantStatus.CHURNED);
      expect(block?.message).toMatch(/encerrada/);
    });

    it('usuário de FILIAL com matriz suspensa → bloqueado (cascata)', async () => {
      mockPrisma.company.findUniqueOrThrow.mockResolvedValue({
        id: 'filial-1',
        name: 'GDR Loja',
        tenantStatus: TenantStatus.ACTIVE,
        suspendReason: null,
        isSandbox: false,
        parent: { ...ROOT_ACTIVE, tenantStatus: TenantStatus.SUSPENDED },
      });
      const block = await service.getLoginBlock('filial-1');
      expect(block?.status).toBe(TenantStatus.SUSPENDED);
    });
  });
});
