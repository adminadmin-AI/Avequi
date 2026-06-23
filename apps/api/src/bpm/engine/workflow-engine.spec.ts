import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkflowEngine, WorkflowDefinition } from './workflow-engine';
import { PrismaService } from '../../prisma/prisma.service';
import { ApprovalService } from '../approval.service';
import { RuleEngine } from './rule-engine';
import { ActionExecutor } from './action-executor';
import { BusinessException } from '../../common/filters/business-exception.filter';

const companyId = 'company-1';

const linearDefinition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'START', config: {} },
    { id: 'action1', type: 'ACTION', config: { actionType: 'SEND_EMAIL' } },
    { id: 'end', type: 'END', config: {} },
  ],
  edges: [
    { from: 'start', to: 'action1' },
    { from: 'action1', to: 'end' },
  ],
};

const approvalDefinition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'START', config: {} },
    { id: 'approval', type: 'APPROVAL', config: { level: 1 } },
    { id: 'end', type: 'END', config: {} },
  ],
  edges: [
    { from: 'start', to: 'approval' },
    { from: 'approval', to: 'end' },
  ],
};

const conditionDefinition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'START', config: {} },
    { id: 'condition', type: 'CONDITION', config: { expression: 'variables.totalAmount > 10000' } },
    { id: 'high', type: 'END', config: {} },
    { id: 'low', type: 'END', config: {} },
  ],
  edges: [
    { from: 'start', to: 'condition' },
    { from: 'condition', to: 'high', condition: 'true' },
    { from: 'condition', to: 'low', condition: 'false' },
  ],
};

const mockWorkflow = {
  id: 'wf-1',
  companyId,
  name: 'Test Workflow',
  entityType: 'PURCHASE_ORDER',
  status: 'ACTIVE',
  versions: [{ id: 'ver-1', isActive: true, definition: linearDefinition }],
};

const mockInstance = {
  id: 'inst-1',
  companyId,
  workflowId: 'wf-1',
  entityType: 'PURCHASE_ORDER',
  entityId: 'po-1',
  status: 'RUNNING',
  currentNodeId: 'start',
  variables: { totalAmount: 15000 },
  workflow: {
    id: 'wf-1',
    versions: [{ id: 'ver-1', isActive: true, definition: linearDefinition }],
  },
};

const mockPrisma = {
  workflow: {
    findFirst: jest.fn(),
  },
  workflowVersion: {
    findFirst: jest.fn(),
  },
  workflowInstance: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  workflowHistory: {
    create: jest.fn(),
  },
  approvalRequest: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockApprovalService = {
  getRequiredApprovals: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockRuleEngine = {
  evaluate: jest.fn().mockReturnValue(false),
};

const mockActionExecutor = {
  execute: jest.fn().mockResolvedValue({ success: true }),
};

describe('WorkflowEngine', () => {
  let engine: WorkflowEngine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowEngine,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ApprovalService, useValue: mockApprovalService },
        { provide: RuleEngine, useValue: mockRuleEngine },
        { provide: ActionExecutor, useValue: mockActionExecutor },
      ],
    }).compile();

    engine = module.get<WorkflowEngine>(WorkflowEngine);
    jest.clearAllMocks();
    mockActionExecutor.execute.mockResolvedValue({ success: true });
  });

  describe('evaluateCondition', () => {
    it('should evaluate > operator correctly', () => {
      expect(engine.evaluateCondition('variables.totalAmount > 10000', { totalAmount: 15000 })).toBe(true);
      expect(engine.evaluateCondition('variables.totalAmount > 10000', { totalAmount: 5000 })).toBe(false);
    });

    it('should evaluate < operator correctly', () => {
      expect(engine.evaluateCondition('variables.qty < 100', { qty: 50 })).toBe(true);
      expect(engine.evaluateCondition('variables.qty < 100', { qty: 150 })).toBe(false);
    });

    it('should evaluate >= operator correctly', () => {
      expect(engine.evaluateCondition('variables.amount >= 10000', { amount: 10000 })).toBe(true);
      expect(engine.evaluateCondition('variables.amount >= 10000', { amount: 9999 })).toBe(false);
    });

    it('should evaluate <= operator correctly', () => {
      expect(engine.evaluateCondition('variables.amount <= 10000', { amount: 10000 })).toBe(true);
      expect(engine.evaluateCondition('variables.amount <= 10000', { amount: 10001 })).toBe(false);
    });

    it('should evaluate == operator correctly', () => {
      expect(engine.evaluateCondition('variables.status == 200', { status: 200 })).toBe(true);
    });

    it('should evaluate != operator correctly', () => {
      expect(engine.evaluateCondition('variables.status != 200', { status: 404 })).toBe(true);
    });

    it('should return false for unrecognized expression', () => {
      expect(engine.evaluateCondition('invalid expression', {})).toBe(false);
    });
  });

  describe('getNextNode', () => {
    it('should return next node following unconditional edge', () => {
      const next = engine.getNextNode(linearDefinition, 'start');
      expect(next?.id).toBe('action1');
    });

    it('should follow true edge when conditionResult is true', () => {
      const next = engine.getNextNode(conditionDefinition, 'condition', true);
      expect(next?.id).toBe('high');
    });

    it('should follow false edge when conditionResult is false', () => {
      const next = engine.getNextNode(conditionDefinition, 'condition', false);
      expect(next?.id).toBe('low');
    });

    it('should return null when no edges exist from node', () => {
      const next = engine.getNextNode(linearDefinition, 'end');
      expect(next).toBeNull();
    });
  });

  describe('startWorkflow', () => {
    it('should create instance and advance from START node through ACTION to END', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({
        id: 'wf-1',
        companyId,
        status: 'ACTIVE',
      });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue({
        id: 'ver-1',
        definition: linearDefinition,
        isActive: true,
      });
      mockPrisma.workflowInstance.create.mockResolvedValue({ ...mockInstance, currentNodeId: 'start' });
      mockPrisma.workflowHistory.create.mockResolvedValue({});
      mockPrisma.workflowInstance.findUnique.mockResolvedValue({
        ...mockInstance,
        workflow: {
          versions: [{ id: 'ver-1', isActive: true, definition: linearDefinition }],
        },
      });
      mockPrisma.workflowInstance.update.mockResolvedValue({
        ...mockInstance,
        status: 'COMPLETED',
      });

      const result = await engine.startWorkflow(companyId, 'wf-1', 'PURCHASE_ORDER', 'po-1', {
        totalAmount: 15000,
      });

      expect(mockPrisma.workflowInstance.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companyId,
            workflowId: 'wf-1',
            entityType: 'PURCHASE_ORDER',
            entityId: 'po-1',
          }),
        }),
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'workflow.action.SEND_EMAIL',
        expect.any(Object),
      );
    });

    it('should throw NOT_FOUND for inactive workflow', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue(null);

      await expect(
        engine.startWorkflow(companyId, 'wf-1', 'PURCHASE_ORDER', 'po-1'),
      ).rejects.toThrow(BusinessException);
    });

    it('should throw BAD_REQUEST when no active version exists', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf-1', status: 'ACTIVE' });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue(null);

      await expect(
        engine.startWorkflow(companyId, 'wf-1', 'PURCHASE_ORDER', 'po-1'),
      ).rejects.toThrow(BusinessException);
    });

    it('should create WAITING_APPROVAL instance for approval workflow', async () => {
      mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf-1', companyId, status: 'ACTIVE' });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue({
        id: 'ver-1',
        definition: approvalDefinition,
        isActive: true,
      });
      mockPrisma.workflowInstance.create.mockResolvedValue({
        ...mockInstance,
        currentNodeId: 'start',
      });
      mockPrisma.workflowHistory.create.mockResolvedValue({});
      mockPrisma.workflowInstance.findUnique.mockResolvedValue({
        ...mockInstance,
        currentNodeId: 'start',
        workflow: {
          versions: [{ id: 'ver-1', isActive: true, definition: approvalDefinition }],
        },
      });
      mockApprovalService.getRequiredApprovals.mockResolvedValue([
        {
          id: 'matrix-1',
          level: 1,
          requiredApprovals: 1,
          approverRoles: ['DIRECTOR'],
        },
      ]);
      mockPrisma.approvalRequest.create.mockResolvedValue({});
      mockPrisma.workflowInstance.update.mockResolvedValue({
        ...mockInstance,
        status: 'WAITING_APPROVAL',
        currentNodeId: 'approval',
      });

      const result = await engine.startWorkflow(
        companyId,
        'wf-1',
        'PURCHASE_ORDER',
        'po-1',
        { totalAmount: 15000 },
      );

      expect(result.status).toBe('WAITING_APPROVAL');
    });
  });

  describe('advanceNode', () => {
    it('should throw NOT_FOUND when instance does not exist', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue(null);

      await expect(engine.advanceNode('bad-id')).rejects.toThrow(
        new BusinessException('Instância não encontrada', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw BAD_REQUEST when instance is not RUNNING', async () => {
      mockPrisma.workflowInstance.findUnique.mockResolvedValue({
        ...mockInstance,
        status: 'COMPLETED',
        workflow: { versions: [{ isActive: true, definition: linearDefinition }] },
      });

      await expect(engine.advanceNode('inst-1')).rejects.toThrow(BusinessException);
    });
  });

  describe('end-to-end PO approval scenario', () => {
    it('should handle complete PO approval flow: START → APPROVAL → END', async () => {
      const poDefinition: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'condition', type: 'CONDITION', config: { expression: 'variables.totalAmount > 10000' } },
          { id: 'approval-high', type: 'APPROVAL', config: { level: 1 } },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [
          { from: 'start', to: 'condition' },
          { from: 'condition', to: 'approval-high', condition: 'true' },
          { from: 'condition', to: 'end', condition: 'false' },
          { from: 'approval-high', to: 'end' },
        ],
      };

      // Start
      mockPrisma.workflow.findFirst.mockResolvedValue({ id: 'wf-1', companyId, status: 'ACTIVE' });
      mockPrisma.workflowVersion.findFirst.mockResolvedValue({
        id: 'ver-1',
        definition: poDefinition,
        isActive: true,
      });
      mockPrisma.workflowInstance.create.mockResolvedValue({
        ...mockInstance,
        currentNodeId: 'start',
        variables: { totalAmount: 15000 },
      });
      mockPrisma.workflowHistory.create.mockResolvedValue({});
      mockPrisma.workflowInstance.findUnique.mockResolvedValue({
        ...mockInstance,
        currentNodeId: 'start',
        variables: { totalAmount: 15000 },
        workflow: { versions: [{ id: 'ver-1', isActive: true, definition: poDefinition }] },
      });
      mockApprovalService.getRequiredApprovals.mockResolvedValue([
        { id: 'matrix-1', level: 1, requiredApprovals: 1, approverRoles: ['DIRECTOR'] },
      ]);
      mockPrisma.approvalRequest.create.mockResolvedValue({});
      mockPrisma.workflowInstance.update.mockResolvedValue({
        ...mockInstance,
        status: 'WAITING_APPROVAL',
        currentNodeId: 'approval-high',
      });

      const startResult = await engine.startWorkflow(
        companyId,
        'wf-1',
        'PURCHASE_ORDER',
        'po-1',
        { totalAmount: 15000 },
      );

      // totalAmount 15000 > 10000 → should go to approval-high
      expect(startResult.status).toBe('WAITING_APPROVAL');

      // Now advance after approval completes
      // After approval.approve() sets status=RUNNING, advanceNode is called with action='APPROVE'
      // The engine sees no PENDING approvals + action=APPROVE → advances to END node
      mockPrisma.workflowInstance.findUnique.mockResolvedValue({
        ...mockInstance,
        currentNodeId: 'approval-high',
        status: 'RUNNING', // set back to RUNNING after approve
        variables: { totalAmount: 15000 },
        workflow: { versions: [{ id: 'ver-1', isActive: true, definition: poDefinition }] },
      });
      // No pending approvals remain
      mockPrisma.approvalRequest.findFirst
        .mockResolvedValueOnce(null) // no pending
        .mockResolvedValueOnce({ id: 'req-1', status: 'APPROVED' }); // has approved
      mockPrisma.workflowInstance.update.mockResolvedValue({
        ...mockInstance,
        status: 'COMPLETED',
        completedAt: new Date(),
      });

      const advanceResult = await engine.advanceNode('inst-1', 'APPROVE', 'user-director');
      expect(advanceResult.status).toBe('COMPLETED');
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'workflow.completed',
        expect.any(Object),
      );
    });
  });
});
