import { Test, TestingModule } from '@nestjs/testing';
import { DryRunService } from './dry-run.service';
import { RuleEngine } from './rule-engine';
import { WorkflowDefinition } from './workflow-engine';

const linearDef: WorkflowDefinition = {
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

const conditionDef: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'START', config: {} },
    {
      id: 'check',
      type: 'CONDITION',
      config: { rule: { '>': [{ var: 'totalAmount' }, 10000] } },
    },
    { id: 'high-path', type: 'ACTION', config: { actionType: 'SEND_EMAIL' } },
    { id: 'low-path', type: 'ACTION', config: { actionType: 'CREATE_NOTIFICATION' } },
    { id: 'end', type: 'END', config: {} },
  ],
  edges: [
    { from: 'start', to: 'check' },
    { from: 'check', to: 'high-path', condition: 'true' },
    { from: 'check', to: 'low-path', condition: 'false' },
    { from: 'high-path', to: 'end' },
    { from: 'low-path', to: 'end' },
  ],
};

const approvalDef: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'START', config: {} },
    { id: 'approval', type: 'APPROVAL', config: { level: 1 } },
    { id: 'action1', type: 'ACTION', config: { actionType: 'SEND_EMAIL' } },
    { id: 'end', type: 'END', config: {} },
  ],
  edges: [
    { from: 'start', to: 'approval' },
    { from: 'approval', to: 'action1' },
    { from: 'action1', to: 'end' },
  ],
};

describe('DryRunService', () => {
  let service: DryRunService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DryRunService, RuleEngine],
    }).compile();

    service = module.get<DryRunService>(DryRunService);
  });

  // ─── Basic path tracing ───────────────────────────────────────────────────

  describe('linear workflow', () => {
    it('traces full path start → action → end', () => {
      const result = service.dryRun(linearDef, {});
      expect(result.success).toBe(true);
      expect(result.path.map((p) => p.nodeId)).toEqual(['start', 'action1', 'end']);
    });

    it('collects action type in path step', () => {
      const result = service.dryRun(linearDef, {});
      const actionStep = result.path.find((p) => p.nodeId === 'action1');
      expect(actionStep?.action).toBe('SEND_EMAIL');
    });

    it('returns success=true for complete path', () => {
      const result = service.dryRun(linearDef, {});
      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns the input variables untouched', () => {
      const vars = { foo: 'bar', totalAmount: 500 };
      const result = service.dryRun(linearDef, vars);
      expect(result.variables).toEqual(vars);
    });
  });

  // ─── Condition branching ──────────────────────────────────────────────────

  describe('condition branching', () => {
    it('follows true branch when condition evaluates to true', () => {
      const result = service.dryRun(conditionDef, { totalAmount: 15000 });
      expect(result.success).toBe(true);
      const nodeIds = result.path.map((p) => p.nodeId);
      expect(nodeIds).toContain('high-path');
      expect(nodeIds).not.toContain('low-path');
    });

    it('follows false branch when condition evaluates to false', () => {
      const result = service.dryRun(conditionDef, { totalAmount: 5000 });
      expect(result.success).toBe(true);
      const nodeIds = result.path.map((p) => p.nodeId);
      expect(nodeIds).toContain('low-path');
      expect(nodeIds).not.toContain('high-path');
    });

    it('records condition result in path step action field', () => {
      const result = service.dryRun(conditionDef, { totalAmount: 15000 });
      const condStep = result.path.find((p) => p.nodeId === 'check');
      expect(condStep?.action).toBe('true');
    });

    it('handles false condition path', () => {
      const result = service.dryRun(conditionDef, { totalAmount: 1000 });
      const condStep = result.path.find((p) => p.nodeId === 'check');
      expect(condStep?.action).toBe('false');
    });
  });

  // ─── Action collection ────────────────────────────────────────────────────

  describe('action collection', () => {
    it('approval node is auto-approved in dry-run', () => {
      const result = service.dryRun(approvalDef, {});
      expect(result.success).toBe(true);
      const nodeIds = result.path.map((p) => p.nodeId);
      expect(nodeIds).toContain('approval');
      expect(nodeIds).toContain('end');
    });

    it('approval step includes level in action field', () => {
      const result = service.dryRun(approvalDef, {});
      const approvalStep = result.path.find((p) => p.nodeId === 'approval');
      expect(approvalStep?.action).toBe('APPROVAL_LEVEL_1');
    });
  });

  // ─── Error cases ──────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns error when no START node', () => {
      const def: WorkflowDefinition = {
        nodes: [{ id: 'end', type: 'END', config: {} }],
        edges: [],
      };
      const result = service.dryRun(def, {});
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('START');
    });

    it('returns error for workflow without END', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'action1', type: 'ACTION', config: { actionType: 'SEND_EMAIL' } },
        ],
        edges: [{ from: 'start', to: 'action1' }],
      };
      const result = service.dryRun(def, {});
      expect(result.success).toBe(false);
      expect(result.errors.some((e) => e.includes('END'))).toBe(true);
    });

    it('handles WAIT node — stops and returns success', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'wait', type: 'WAIT', config: {} },
        ],
        edges: [{ from: 'start', to: 'wait' }],
      };
      const result = service.dryRun(def, {});
      expect(result.success).toBe(true);
      expect(result.path.map((p) => p.nodeId)).toContain('wait');
    });

    it('condition error is captured in errors array', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          {
            id: 'check',
            type: 'CONDITION',
            config: { rule: { unknownOp: [] } },
          },
          { id: 'end-true', type: 'END', config: {} },
          { id: 'end-false', type: 'END', config: {} },
        ],
        edges: [
          { from: 'start', to: 'check' },
          { from: 'check', to: 'end-true', condition: 'true' },
          { from: 'check', to: 'end-false', condition: 'false' },
        ],
      };
      const result = service.dryRun(def, {});
      // Error is logged but execution continues on false branch
      expect(result.errors.some((e) => e.includes('check'))).toBe(true);
    });
  });
});
