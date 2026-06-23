import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { WorkflowTemplateService } from './workflow-template.service';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';

const mockPrisma = {
  workflowTemplate: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  workflow: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  workflowVersion: {
    create: jest.fn(),
  },
};

describe('WorkflowTemplateService', () => {
  let service: WorkflowTemplateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WorkflowTemplateService>(WorkflowTemplateService);
    jest.clearAllMocks();
  });

  // ─── getBuiltInTemplates ──────────────────────────────────────────────────

  describe('getBuiltInTemplates', () => {
    it('returns all 3 built-in templates when no category', () => {
      const templates = service.getBuiltInTemplates();
      expect(templates).toHaveLength(3);
    });

    it('returns only APPROVAL templates when category=APPROVAL', () => {
      const templates = service.getBuiltInTemplates('APPROVAL');
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('Aprovação de PO');
    });

    it('returns SALES templates', () => {
      const templates = service.getBuiltInTemplates('SALES');
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('Fluxo de Venda');
    });

    it('returns ONBOARDING templates', () => {
      const templates = service.getBuiltInTemplates('ONBOARDING');
      expect(templates).toHaveLength(1);
      expect(templates[0].name).toBe('Onboarding de Fornecedor');
    });

    it('returns empty array for unknown category', () => {
      const templates = service.getBuiltInTemplates('UNKNOWN');
      expect(templates).toHaveLength(0);
    });

    it('built-in PO template has correct node structure', () => {
      const templates = service.getBuiltInTemplates('APPROVAL');
      const def = templates[0].definition;
      expect(def.nodes.some((n) => n.type === 'START')).toBe(true);
      expect(def.nodes.some((n) => n.type === 'END')).toBe(true);
      expect(def.nodes.some((n) => n.type === 'CONDITION')).toBe(true);
      expect(def.nodes.filter((n) => n.type === 'APPROVAL')).toHaveLength(2);
    });

    it('built-in PO template has isBuiltIn=true', () => {
      const templates = service.getBuiltInTemplates();
      expect(templates.every((t) => t.isBuiltIn)).toBe(true);
    });
  });

  // ─── findAll ──────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns built-in + db templates', async () => {
      const dbTemplate = {
        id: 'db-1',
        name: 'Custom Template',
        entityType: 'PURCHASE_ORDER',
        category: 'APPROVAL',
        isBuiltIn: false,
        definition: {},
        createdAt: new Date(),
      };
      mockPrisma.workflowTemplate.findMany.mockResolvedValue([dbTemplate]);

      const result = await service.findAll();
      expect(result.length).toBeGreaterThanOrEqual(4); // 3 built-in + 1 db
      expect(result).toContainEqual(expect.objectContaining({ id: 'db-1' }));
    });

    it('filters by category', async () => {
      mockPrisma.workflowTemplate.findMany.mockResolvedValue([]);
      const result = await service.findAll('APPROVAL');
      expect(mockPrisma.workflowTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { category: 'APPROVAL' } }),
      );
      // 1 built-in APPROVAL + 0 db
      expect(result).toHaveLength(1);
    });
  });

  // ─── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns built-in template by id', async () => {
      const result = await service.findOne('builtin-po-approval');
      expect(result).toMatchObject({ id: 'builtin-po-approval', isBuiltIn: true });
    });

    it('returns db template by id', async () => {
      const dbTemplate = { id: 'db-1', name: 'DB Template', entityType: 'SALES_ORDER' };
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue(dbTemplate);
      const result = await service.findOne('db-1');
      expect(result).toMatchObject({ id: 'db-1' });
    });

    it('throws NOT_FOUND if db template not found', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessException);
    });

    it('not-found error has status 404', async () => {
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue(null);
      try {
        await service.findOne('non-existent');
      } catch (e: any) {
        expect(e.status).toBe(HttpStatus.NOT_FOUND);
      }
    });
  });

  // ─── createFromTemplate ───────────────────────────────────────────────────

  describe('createFromTemplate', () => {
    const companyId = 'company-1';
    const templateId = 'builtin-po-approval';
    const workflowName = 'Meu Workflow PO';

    it('creates workflow and version from built-in template', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);
      const createdWorkflow = {
        id: 'wf-new',
        companyId,
        name: workflowName,
        entityType: 'PURCHASE_ORDER',
      };
      const createdVersion = { id: 'ver-1', workflowId: 'wf-new', version: 1 };
      mockPrisma.workflow.create.mockResolvedValue(createdWorkflow);
      mockPrisma.workflowVersion.create.mockResolvedValue(createdVersion);

      const result = await service.createFromTemplate(companyId, templateId, workflowName);
      expect(result.workflow).toMatchObject({ id: 'wf-new', name: workflowName });
      expect(result.version).toMatchObject({ version: 1 });
    });

    it('creates version with isActive=false', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);
      mockPrisma.workflow.create.mockResolvedValue({ id: 'wf-2', entityType: 'PURCHASE_ORDER' });
      mockPrisma.workflowVersion.create.mockResolvedValue({ id: 'ver-2' });

      await service.createFromTemplate(companyId, templateId, workflowName);

      expect(mockPrisma.workflowVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ isActive: false, version: 1 }),
        }),
      );
    });

    it('throws CONFLICT if workflow name already exists', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'existing-wf' });

      await expect(
        service.createFromTemplate(companyId, templateId, workflowName),
      ).rejects.toThrow(BusinessException);
    });

    it('throws NOT_FOUND for invalid templateId', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);
      mockPrisma.workflowTemplate.findUnique.mockResolvedValue(null);

      await expect(
        service.createFromTemplate(companyId, 'invalid-template-id', workflowName),
      ).rejects.toThrow(BusinessException);
    });

    it('copies template definition into version', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);
      mockPrisma.workflow.create.mockResolvedValue({ id: 'wf-3', entityType: 'PURCHASE_ORDER' });
      mockPrisma.workflowVersion.create.mockResolvedValue({ id: 'ver-3' });

      await service.createFromTemplate(companyId, templateId, workflowName);

      const createCall = mockPrisma.workflowVersion.create.mock.calls[0][0];
      const definition = createCall.data.definition;
      expect(Array.isArray(definition.nodes)).toBe(true);
      expect(Array.isArray(definition.edges)).toBe(true);
    });
  });
});
