import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowDiffService } from './workflow-diff.service';
import { WorkflowDefinition } from './engine/workflow-engine';

const baseDefinition: WorkflowDefinition = {
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

describe('WorkflowDiffService', () => {
  let service: WorkflowDiffService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowDiffService],
    }).compile();

    service = module.get<WorkflowDiffService>(WorkflowDiffService);
  });

  // ─── No changes ───────────────────────────────────────────────────────────

  describe('identical definitions', () => {
    it('returns empty diff for identical definitions', () => {
      const diff = service.diff(baseDefinition, baseDefinition);
      expect(diff.addedNodes).toHaveLength(0);
      expect(diff.removedNodes).toHaveLength(0);
      expect(diff.modifiedNodes).toHaveLength(0);
      expect(diff.addedEdges).toHaveLength(0);
      expect(diff.removedEdges).toHaveLength(0);
    });
  });

  // ─── Added nodes ──────────────────────────────────────────────────────────

  describe('added nodes', () => {
    it('detects newly added node', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          ...baseDefinition.nodes,
          { id: 'approval', type: 'APPROVAL', config: { level: 1 } },
        ],
        edges: [...baseDefinition.edges],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.addedNodes).toContain('approval');
    });

    it('does not report added node as removed', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          ...baseDefinition.nodes,
          { id: 'new-node', type: 'ACTION', config: {} },
        ],
        edges: [...baseDefinition.edges],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.removedNodes).not.toContain('new-node');
    });
  });

  // ─── Removed nodes ────────────────────────────────────────────────────────

  describe('removed nodes', () => {
    it('detects removed node', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [{ from: 'start', to: 'end' }],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.removedNodes).toContain('action1');
    });

    it('does not report removed node as added', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [{ from: 'start', to: 'end' }],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.addedNodes).not.toContain('action1');
    });
  });

  // ─── Modified nodes ───────────────────────────────────────────────────────

  describe('modified nodes', () => {
    it('detects config change', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'action1', type: 'ACTION', config: { actionType: 'CREATE_NOTIFICATION' } },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [...baseDefinition.edges],
      };
      const diff = service.diff(baseDefinition, vB);
      const mod = diff.modifiedNodes.find((m) => m.id === 'action1');
      expect(mod).toBeDefined();
      expect(mod?.changes['config.actionType']).toEqual({
        from: 'SEND_EMAIL',
        to: 'CREATE_NOTIFICATION',
      });
    });

    it('detects type change', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'action1', type: 'APPROVAL', config: { level: 1 } },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [...baseDefinition.edges],
      };
      const diff = service.diff(baseDefinition, vB);
      const mod = diff.modifiedNodes.find((m) => m.id === 'action1');
      expect(mod?.changes['type']).toEqual({ from: 'ACTION', to: 'APPROVAL' });
    });

    it('does not report unmodified nodes', () => {
      const vB: WorkflowDefinition = {
        nodes: [
          { id: 'start', type: 'START', config: {} },
          { id: 'action1', type: 'ACTION', config: { actionType: 'SEND_EMAIL' } },
          { id: 'end', type: 'END', config: {} },
        ],
        edges: [...baseDefinition.edges],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.modifiedNodes).toHaveLength(0);
    });
  });

  // ─── Edge changes ─────────────────────────────────────────────────────────

  describe('edge changes', () => {
    it('detects added edge', () => {
      const vB: WorkflowDefinition = {
        nodes: [...baseDefinition.nodes],
        edges: [
          ...baseDefinition.edges,
          { from: 'start', to: 'end' },
        ],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.addedEdges).toContainEqual({ from: 'start', to: 'end' });
    });

    it('detects removed edge', () => {
      const vB: WorkflowDefinition = {
        nodes: [...baseDefinition.nodes],
        edges: [{ from: 'start', to: 'action1' }],
      };
      const diff = service.diff(baseDefinition, vB);
      expect(diff.removedEdges).toContainEqual({ from: 'action1', to: 'end' });
    });

    it('no edge changes for identical edges', () => {
      const diff = service.diff(baseDefinition, baseDefinition);
      expect(diff.addedEdges).toHaveLength(0);
      expect(diff.removedEdges).toHaveLength(0);
    });
  });
});
