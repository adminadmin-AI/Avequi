import { getQueueToken } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditProcessor } from './audit.processor';
import { AuditService } from './audit.service';
import { AUDIT_JOB_PERSIST, AUDIT_QUEUE, AuditLogEntry } from './audit.types';

const baseEntry: AuditLogEntry = {
  companyId: 'co-1',
  userId: 'user-1',
  entity: 'Product',
  entityId: 'prod-1',
  action: AuditAction.UPDATE,
  module: 'product',
};

describe('AuditService (#343)', () => {
  let service: AuditService;
  let mockQueue: { add: jest.Mock };
  let mockPrisma: any;

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    mockPrisma = {
      auditLogV2: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getQueueToken(AUDIT_QUEUE), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(AuditService);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('log — fila saudável', () => {
    it('enfileira na AUDIT_QUEUE com retry/backoff e NÃO grava direto no banco', async () => {
      await service.log(baseEntry);

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        AUDIT_JOB_PERSIST,
        expect.objectContaining({ companyId: 'co-1', entity: 'Product' }),
        expect.objectContaining({
          attempts: 3,
          backoff: expect.objectContaining({ type: 'exponential' }),
        }),
      );
      expect(mockPrisma.auditLogV2.create).not.toHaveBeenCalled();
    });

    it('redige campos sensíveis ANTES de enfileirar (defesa em profundidade)', async () => {
      await service.log({
        ...baseEntry,
        newValue: { name: 'x', passwordHash: 'super-secreto' },
      });

      const payload = mockQueue.add.mock.calls[0][1];
      expect(payload.newValue.passwordHash).toBe('[REDACTED]');
      expect(JSON.stringify(payload)).not.toContain('super-secreto');
    });
  });

  describe('log — fallback síncrono (fila indisponível)', () => {
    it('grava direto no banco quando o queue.add falha', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis down'));

      await service.log(baseEntry);

      expect(mockPrisma.auditLogV2.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.auditLogV2.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId: 'co-1',
            entity: 'Product',
            entityId: 'prod-1',
            action: AuditAction.UPDATE,
          }),
        }),
      );
    });

    it('NUNCA lança quando fila E banco estão indisponíveis — loga erro estruturado', async () => {
      mockQueue.add.mockRejectedValue(new Error('Redis down'));
      mockPrisma.auditLogV2.create.mockRejectedValue(new Error('DB down'));
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      await expect(service.log(baseEntry)).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Falha total'),
          queueError: 'Redis down',
          dbError: 'DB down',
          entry: expect.objectContaining({ entity: 'Product', companyId: 'co-1' }),
        }),
      );
    });
  });

  describe('logWithDiff', () => {
    it('grava só os campos alterados como oldValue/newValue', async () => {
      await service.logWithDiff(
        { status: 'ACTIVE', name: 'A' },
        { status: 'REVOKED', name: 'A' },
        baseEntry,
      );

      const payload = mockQueue.add.mock.calls[0][1];
      expect(payload.oldValue).toEqual({ status: 'ACTIVE' });
      expect(payload.newValue).toEqual({ status: 'REVOKED' });
    });

    it('não registra nada quando não houve mudança', async () => {
      await service.logWithDiff({ a: 1 }, { a: 1 }, baseEntry);
      expect(mockQueue.add).not.toHaveBeenCalled();
      expect(mockPrisma.auditLogV2.create).not.toHaveBeenCalled();
    });
  });

  describe('findLogs (endpoint GET /iam/audit-logs)', () => {
    it('escopa por companyId, aplica filtros e pagina', async () => {
      mockPrisma.auditLogV2.count.mockResolvedValue(120);
      mockPrisma.auditLogV2.findMany.mockResolvedValue([{ id: 'log-1' }]);

      const result = await service.findLogs('co-1', {
        entity: 'Product',
        userId: 'user-9',
        action: AuditAction.DELETE,
        from: '2026-01-01',
        to: '2026-06-30',
        page: 3,
        pageSize: 25,
      });

      expect(mockPrisma.auditLogV2.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            companyId: 'co-1',
            entity: 'Product',
            userId: 'user-9',
            action: AuditAction.DELETE,
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-06-30'),
            },
          }),
          orderBy: { createdAt: 'desc' },
          skip: 50, // (page 3 - 1) * 25
          take: 25,
        }),
      );
      expect(result).toEqual(
        expect.objectContaining({ total: 120, page: 3, pageSize: 25, totalPages: 5 }),
      );
    });

    it('usa defaults de paginação e limita pageSize a 200', async () => {
      await service.findLogs('co-1', { pageSize: 9999 });
      expect(mockPrisma.auditLogV2.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 200 }),
      );
    });
  });

  describe('AuditProcessor (worker da fila)', () => {
    it('persiste o job e relança erro de banco para o retry do Bull', async () => {
      const processor = new AuditProcessor(service);
      const persistSpy = jest.spyOn(service, 'persist').mockResolvedValue();

      await processor.handlePersist({ id: 'j1', data: baseEntry, attemptsMade: 0 } as any);
      expect(persistSpy).toHaveBeenCalledWith(baseEntry);

      persistSpy.mockRejectedValue(new Error('DB down'));
      await expect(
        processor.handlePersist({ id: 'j1', data: baseEntry, attemptsMade: 1 } as any),
      ).rejects.toThrow('DB down');
    });
  });
});
