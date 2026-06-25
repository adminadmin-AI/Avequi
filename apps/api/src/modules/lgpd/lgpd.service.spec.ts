import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LgpdService } from './lgpd.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LgpdService', () => {
  let service: LgpdService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      consentRecord: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      anonymizationRequest: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      customer: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      supplier: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LgpdService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LgpdService>(LgpdService);
  });

  describe('registerConsent', () => {
    it('should create a consent record', async () => {
      const data = {
        subjectType: 'Customer',
        subjectId: 'cust-1',
        document: '12345678900',
        purpose: 'COMMERCIAL',
        legalBasis: 'Art. 7, I — consentimento',
        collectedBy: 'user-1',
      };
      prisma.consentRecord.create.mockResolvedValue({ id: 'consent-1', ...data });

      const result = await service.registerConsent('comp-1', data);

      expect(result.id).toBe('consent-1');
      expect(prisma.consentRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ companyId: 'comp-1', document: '12345678900' }),
        }),
      );
    });
  });

  describe('revokeConsent', () => {
    it('should revoke an active consent', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ id: 'consent-1', status: 'ACTIVE' });
      prisma.consentRecord.update.mockResolvedValue({ id: 'consent-1', status: 'REVOKED' });

      const result = await service.revokeConsent('consent-1', 'comp-1');
      expect(result.status).toBe('REVOKED');
    });

    it('should throw if consent already revoked', async () => {
      prisma.consentRecord.findFirst.mockResolvedValue({ id: 'consent-1', status: 'REVOKED' });

      await expect(service.revokeConsent('consent-1', 'comp-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('getDataSubject', () => {
    it('should return all data for a document (portability)', async () => {
      prisma.customer.findMany.mockResolvedValue([{ id: 'c1', name: 'João', document: '12345678900' }]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.consentRecord.findMany.mockResolvedValue([{ id: 'consent-1', purpose: 'COMMERCIAL' }]);

      const result = await service.getDataSubject('comp-1', '12345678900');

      expect(result.document).toBe('12345678900');
      expect(result.customers).toHaveLength(1);
      expect(result.consents).toHaveLength(1);
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });
  });

  describe('requestAnonymization', () => {
    it('should create anonymization request', async () => {
      prisma.anonymizationRequest.findFirst.mockResolvedValue(null);
      prisma.customer.findFirst.mockResolvedValue({ name: 'João' });
      prisma.anonymizationRequest.create.mockResolvedValue({
        id: 'req-1',
        document: '12345678900',
        status: 'REQUESTED',
      });

      const result = await service.requestAnonymization('comp-1', '12345678900', 'user-1');
      expect(result.status).toBe('REQUESTED');
    });

    it('should throw if pending request already exists', async () => {
      prisma.anonymizationRequest.findFirst.mockResolvedValue({ id: 'req-1', status: 'REQUESTED' });

      await expect(
        service.requestAnonymization('comp-1', '12345678900', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processAnonymization', () => {
    it('should anonymize customer data and revoke consents', async () => {
      prisma.anonymizationRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        companyId: 'comp-1',
        document: '12345678900',
        status: 'REQUESTED',
      });
      prisma.anonymizationRequest.update.mockResolvedValue({});
      prisma.customer.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.customer.update.mockResolvedValue({});
      prisma.user.findMany.mockResolvedValue([]);
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.consentRecord.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.processAnonymization('req-1', 'comp-1');

      expect(result.affected.customers).toBe(1);
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            phone: null,
            address: null,
          }),
        }),
      );
      expect(prisma.consentRecord.updateMany).toHaveBeenCalled();
    });

    it('should maintain referential integrity (keep ID, mask name)', async () => {
      prisma.anonymizationRequest.findFirst.mockResolvedValue({
        id: 'req-1',
        companyId: 'comp-1',
        document: '12345678900',
        status: 'REQUESTED',
      });
      prisma.anonymizationRequest.update.mockResolvedValue({});
      prisma.customer.findMany.mockResolvedValue([{ id: 'c1' }]);
      prisma.customer.update.mockResolvedValue({});
      prisma.user.findMany.mockResolvedValue([]);
      prisma.supplier.findMany.mockResolvedValue([]);
      prisma.consentRecord.updateMany.mockResolvedValue({ count: 0 });

      await service.processAnonymization('req-1', 'comp-1');

      // Customer update should replace name with ANONIMIZADO prefix
      const updateCall = prisma.customer.update.mock.calls[0][0];
      expect(updateCall.data.name).toMatch(/^ANONIMIZADO_/);
      // ID is NOT changed (referential integrity)
      expect(updateCall.where.id).toBe('c1');
    });
  });
});
