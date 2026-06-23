import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { WorkflowService } from './workflow.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockWorkflow = {
  id: 'wf-1',
  companyId: 'company-1',
  name: 'Aprovação PO',
  entityType: 'PURCHASE_ORDER',
  description: 'Fluxo de aprovação de ordens de compra',
  triggerEvent: 'purchase-order.created',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockVersion = {
  id: 'ver-1',
  workflowId: 'wf-1',
  version: 1,
  definition: {
    nodes: [
      { id: 'start', type: 'START', config: {} },
      { id: 'approval', type: 'APPROVAL', config: { level: 1 } },
      { id: 'end', type: 'END', config: {} },
    ],
    edges: [
      { from: 'start', to: 'approval' },
      { from: 'approval', to: 'end' },
    ],
  },
  isActive: false,
  publishedAt: null,
  createdAt: new Date(),
};

const mockPrisma = {
  workflow: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  workflowVersion: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
};

describe('WorkflowService', () => {
  let service: WorkflowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WorkflowService>(WorkflowService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a workflow successfully', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);
      mockPrisma.workflow.create.mockResolvedValue(mockWorkflow);

      const result = await service.create('company-1', {
        name: 'Aprovação PO',
        entityType: 'PURCHASE_ORDER',
        triggerEvent: 'purchase-order.created',
      });

      expect(mockPrisma.workflow.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          name: 'Aprovação PO',
          entityType: 'PURCHASE_ORDER',
        }),
      });
      expect(result).toEqual(mockWorkflow);
    });

    it('should throw CONFLICT if workflow name already exists', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(mockWorkflow);

      await expect(
        service.create('company-1', { name: 'Aprovação PO', entityType: 'PURCHASE_ORDER' }),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('findAll', () => {
    it('should return workflows for company', async () => {
      mockPrisma.workflow.findMany.mockResolvedValue([mockWorkflow]);

      const result = await service.findAll('company-1');

      expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ companyId: 'company-1' }) }),
      );
      expect(result).toHaveLength(1);
    });

    it('should filter by entityType when provided', async () => {
      mockPrisma.workflow.findMany.mockResolvedValue([mockWorkflow]);

      await service.findAll('company-1', 'PURCHASE_ORDER');

      expect(mockPrisma.workflow.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityType: 'PURCHASE_ORDER' }),
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return workflow by id', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({
        ...mockWorkflow,
        versions: [],
      });

      const result = await service.findOne('company-1', 'wf-1');
      expect(result).toMatchObject({ id: 'wf-1' });
    });

    it('should throw NOT_FOUND when workflow does not exist', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);

      await expect(service.findOne('company-1', 'nonexistent')).rejects.toThrow(
        new BusinessException('Workflow não encontrado', HttpStatus.NOT_FOUND),
      );
    });
  });

  describe('update', () => {
    it('should update workflow', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflow, versions: [] });
      mockPrisma.workflow.update.mockResolvedValue({ ...mockWorkflow, name: 'Updated' });

      const result = await service.update('company-1', 'wf-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });
  });

  describe('archive', () => {
    it('should set workflow status to ARCHIVED', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflow, versions: [] });
      mockPrisma.workflow.update.mockResolvedValue({ ...mockWorkflow, status: 'ARCHIVED' });

      const result = await service.archive('company-1', 'wf-1');
      expect(mockPrisma.workflow.update).toHaveBeenCalledWith({
        where: { id: 'wf-1' },
        data: { status: 'ARCHIVED' },
      });
      expect(result.status).toBe('ARCHIVED');
    });
  });

  describe('createVersion', () => {
    it('should create version 1 when no prior versions exist', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflow, versions: [] });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue(null);
      mockPrisma.workflowVersion.create.mockResolvedValue({ ...mockVersion, version: 1 });

      const result = await service.createVersion('company-1', 'wf-1', {
        definition: mockVersion.definition,
      });

      expect(mockPrisma.workflowVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 1, isActive: false }),
        }),
      );
      expect(result.version).toBe(1);
    });

    it('should auto-increment version number', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflow, versions: [] });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue({ ...mockVersion, version: 3 });
      mockPrisma.workflowVersion.create.mockResolvedValue({ ...mockVersion, version: 4 });

      await service.createVersion('company-1', 'wf-1', { definition: mockVersion.definition });

      expect(mockPrisma.workflowVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ version: 4 }),
        }),
      );
    });
  });

  describe('publishVersion', () => {
    it('should activate the given version and deactivate others', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflow, versions: [] });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue(mockVersion);
      mockPrisma.workflowVersion.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.workflowVersion.update.mockResolvedValue({
        ...mockVersion,
        isActive: true,
        publishedAt: new Date(),
      });

      const result = await service.publishVersion('company-1', 'wf-1', 'ver-1');

      expect(mockPrisma.workflowVersion.updateMany).toHaveBeenCalledWith({
        where: { workflowId: 'wf-1', id: { not: 'ver-1' } },
        data: { isActive: false },
      });
      expect(mockPrisma.workflowVersion.update).toHaveBeenCalledWith({
        where: { id: 'ver-1' },
        data: expect.objectContaining({ isActive: true }),
      });
      expect(result.isActive).toBe(true);
    });

    it('should throw NOT_FOUND if version does not belong to workflow', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ ...mockWorkflow, versions: [] });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue(null);

      await expect(
        service.publishVersion('company-1', 'wf-1', 'wrong-ver'),
      ).rejects.toThrow(BusinessException);
    });
  });

  describe('getActiveVersion', () => {
    it('should return active version', async () => {
      mockPrisma.workflowVersion.findFirst.mockResolvedValue({ ...mockVersion, isActive: true });

      const result = await service.getActiveVersion('wf-1');
      expect(result.isActive).toBe(true);
    });

    it('should throw NOT_FOUND when no active version', async () => {
      mockPrisma.workflowVersion.findFirst.mockResolvedValue(null);

      await expect(service.getActiveVersion('wf-1')).rejects.toThrow(BusinessException);
    });
  });
});
