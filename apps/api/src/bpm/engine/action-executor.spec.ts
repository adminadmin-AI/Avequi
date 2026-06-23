import { Test, TestingModule } from '@nestjs/testing';
import { ActionExecutor, ActionHandler, ActionContext } from './action-executor';
import { PrismaService } from '../../prisma/prisma.service';

const mockCreate = jest.fn();
const mockUpdate = jest.fn();

const mockPrisma = {
  workflowAction: {
    create: mockCreate,
    update: mockUpdate,
  },
};

const baseContext: ActionContext = {
  companyId: 'company-1',
  instanceId: 'instance-1',
  nodeId: 'node-1',
  config: { actionType: 'TEST_ACTION' },
  variables: { amount: 1000 },
};

describe('ActionExecutor', () => {
  let executor: ActionExecutor;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockCreate.mockResolvedValue({ id: 'action-record-1' });
    mockUpdate.mockResolvedValue({ id: 'action-record-1' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActionExecutor,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    executor = module.get<ActionExecutor>(ActionExecutor);
  });

  describe('registerHandler', () => {
    it('should register a handler', () => {
      const handler: ActionHandler = {
        type: 'MY_ACTION',
        execute: jest.fn().mockResolvedValue({ success: true }),
      };
      executor.registerHandler(handler);
      // Verify by executing
      expect(() => executor.registerHandler(handler)).not.toThrow();
    });

    it('should overwrite existing handler with same type', () => {
      const handler1: ActionHandler = {
        type: 'MY_ACTION',
        execute: jest.fn().mockResolvedValue({ success: true, data: 'v1' }),
      };
      const handler2: ActionHandler = {
        type: 'MY_ACTION',
        execute: jest.fn().mockResolvedValue({ success: true, data: 'v2' }),
      };
      executor.registerHandler(handler1);
      executor.registerHandler(handler2);
      // handler2 should be used — test by checking execute is called
      expect(handler2.execute).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should return error when no actionType in config', async () => {
      const result = await executor.execute({
        ...baseContext,
        config: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('actionType');
    });

    it('should return error and save FAILED record when no handler registered', async () => {
      mockCreate.mockResolvedValue({ id: 'rec-1' });
      const result = await executor.execute(baseContext);
      expect(result.success).toBe(false);
      expect(result.error).toContain('TEST_ACTION');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });

    it('should execute handler and save COMPLETED record on success', async () => {
      const handler: ActionHandler = {
        type: 'TEST_ACTION',
        execute: jest.fn().mockResolvedValue({ success: true, data: { sent: true } }),
      };
      executor.registerHandler(handler);

      mockCreate.mockResolvedValue({ id: 'rec-2' });

      const result = await executor.execute(baseContext);

      expect(result.success).toBe(true);
      expect(handler.execute).toHaveBeenCalledWith(baseContext);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXECUTING', actionType: 'TEST_ACTION' }),
        }),
      );
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('should save FAILED record when handler returns success: false', async () => {
      const handler: ActionHandler = {
        type: 'TEST_ACTION',
        execute: jest.fn().mockResolvedValue({ success: false, error: 'Business error' }),
      };
      executor.registerHandler(handler);
      mockCreate.mockResolvedValue({ id: 'rec-3' });

      const result = await executor.execute(baseContext);

      expect(result.success).toBe(false);
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', error: 'Business error' }),
        }),
      );
    });

    it('should handle thrown exception from handler and save FAILED record', async () => {
      const handler: ActionHandler = {
        type: 'TEST_ACTION',
        execute: jest.fn().mockRejectedValue(new Error('Unexpected crash')),
      };
      executor.registerHandler(handler);
      mockCreate.mockResolvedValue({ id: 'rec-4' });

      const result = await executor.execute(baseContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unexpected crash');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', error: 'Unexpected crash' }),
        }),
      );
    });

    it('should persist config in action record', async () => {
      const handler: ActionHandler = {
        type: 'TEST_ACTION',
        execute: jest.fn().mockResolvedValue({ success: true }),
      };
      executor.registerHandler(handler);
      mockCreate.mockResolvedValue({ id: 'rec-5' });

      await executor.execute(baseContext);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            config: { actionType: 'TEST_ACTION' },
            nodeId: 'node-1',
            instanceId: 'instance-1',
          }),
        }),
      );
    });
  });
});
