import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowValidator } from './workflow-validator';
import { WorkflowDefinition } from './workflow-engine';

const validLinear: WorkflowDefinition = {
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

const validWithCondition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'START', config: {} },
    { id: 'check', type: 'CONDITION', config: {} },
    { id: 'end-a', type: 'END', config: {} },
    { id: 'end-b', type: 'END', config: {} },
  ],
  edges: [
    { from: 'start', to: 'check' },
    { from: 'check', to: 'end-a', condition: 'true' },
    { from: 'check', to: 'end-b', condition: 'false' },
  ],
};

describe('WorkflowValidator', () => {
  let validator: WorkflowValidator;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowValidator],
    }).compile();

    validator = module.get<WorkflowValidator>(WorkflowValidator);
  });

  // ─── Valid definitions ────────────────────────────────────────────────────

  describe('valid definitions', () => {
    it('passes valid linear workflow', () => {
      const result = validator.validate(validLinear);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes valid workflow with condition node', () => {
      const result = validator.validate(validWithCondition);
      expect(result.valid).toBe(true);
    });

    it('passes workflow with multiple END nodes', () => {
      const result = validator.validate(validWithCondition);
      expect(result.valid).toBe(true);
    });
  });

  // ─── START node validation ────────────────────────────────────────────────

  describe('START node', () => {
    it('fails when no START node', () => {
      const def: WorkflowDefinition = {
        nodes: [{ id: 'end', type: 'END', config: {} }],
        edges: [],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('start'))).toBe(true);
    });

    it('fails when multiple START nodes', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start1', type: 'START', config: {} },
          { id: 'start2', type: 'START', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [
          { from: 'start1', to: 'end' },
          { from: 'start2', to: 'end' },
        ],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('START'))).toBe(true);
    });
  });

  // ─── END node validation ──────────────────────────────────────────────────

  describe('END node', () => {
    it('fails when no END node', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'action1', type: 'ACTION', config: {} },
        ],
        edges: [{ from: 'start', to: 'action1' }],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('end'))).toBe(true);
    });
  });

  // ─── Edge reference validation ────────────────────────────────────────────

  describe('edge references', () => {
    it('fails when edge references invalid from-node', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [
          { from: 'start', to: 'end' },
          { from: 'non-existent', to: 'end' },
        ],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('non-existent'))).toBe(true);
    });

    it('fails when edge references invalid to-node', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [{ from: 'start', to: 'ghost-node' }],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('ghost-node'))).toBe(true);
    });
  });

  // ─── CONDITION node validation ────────────────────────────────────────────

  describe('CONDITION node', () => {
    it('fails when CONDITION node has only 1 outgoing edge', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'check', type: 'CONDITION', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [
          { from: 'start', to: 'check' },
          { from: 'check', to: 'end' },
        ],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('check'))).toBe(true);
    });

    it('passes when CONDITION node has 2 outgoing edges', () => {
      const result = validator.validate(validWithCondition);
      expect(result.valid).toBe(true);
    });
  });

  // ─── Orphan node detection ────────────────────────────────────────────────

  describe('orphan nodes', () => {
    it('fails when node is unreachable from START', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'action1', type: 'ACTION', config: {} },
          { id: 'end', type: 'END', config: {} },
          { id: 'orphan', type: 'ACTION', config: {} }, // not connected
        ],
        edges: [
          { from: 'start', to: 'action1' },
          { from: 'action1', to: 'end' },
        ],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('orphan'))).toBe(true);
    });
  });

  // ─── Cycle detection ─────────────────────────────────────────────────────

  describe('cycle detection', () => {
    it('fails when workflow contains a cycle', () => {
      const def: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'a', type: 'ACTION', config: {} },
          { id: 'b', type: 'ACTION', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [
          { from: 'start', to: 'a' },
          { from: 'a', to: 'b' },
          { from: 'b', to: 'a' }, // cycle: a → b → a
          { from: 'b', to: 'end' },
        ],
      };
      const result = validator.validate(def);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes('ciclo'))).toBe(true);
    });

    it('passes when no cycle exists', () => {
      const result = validator.validate(validLinear);
      expect(result.valid).toBe(true);
    });
  });

  // ─── Invalid input ────────────────────────────────────────────────────────

  describe('invalid input', () => {
    it('handles null definition gracefully', () => {
      const result = validator.validate(null as any);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles missing nodes array', () => {
      const result = validator.validate({ edges: [] } as any);
      expect(result.valid).toBe(false);
    });
  });
});
