import { Injectable } from '@nestjs/common';
import { WorkflowDefinition, WorkflowNode, WorkflowEdge } from './engine/workflow-engine';

export interface NodeChange {
  id: string;
  changes: Record<string, { from: any; to: any }>;
}

export interface WorkflowDiff {
  addedNodes: string[];
  removedNodes: string[];
  modifiedNodes: NodeChange[];
  addedEdges: { from: string; to: string }[];
  removedEdges: { from: string; to: string }[];
}

@Injectable()
export class WorkflowDiffService {
  diff(versionA: WorkflowDefinition, versionB: WorkflowDefinition): WorkflowDiff {
    const nodesA = new Map<string, WorkflowNode>(versionA.nodes.map((n) => [n.id, n]));
    const nodesB = new Map<string, WorkflowNode>(versionB.nodes.map((n) => [n.id, n]));

    const addedNodes: string[] = [];
    const removedNodes: string[] = [];
    const modifiedNodes: NodeChange[] = [];

    // Nodes in B not in A → added
    for (const [id] of nodesB) {
      if (!nodesA.has(id)) {
        addedNodes.push(id);
      }
    }

    // Nodes in A not in B → removed
    for (const [id] of nodesA) {
      if (!nodesB.has(id)) {
        removedNodes.push(id);
      }
    }

    // Nodes in both → check for modifications
    for (const [id, nodeA] of nodesA) {
      const nodeB = nodesB.get(id);
      if (!nodeB) continue;

      const changes: Record<string, { from: any; to: any }> = {};

      if (nodeA.type !== nodeB.type) {
        changes['type'] = { from: nodeA.type, to: nodeB.type };
      }

      // Deep compare config
      const configChanges = this.diffObjects(nodeA.config ?? {}, nodeB.config ?? {});
      for (const [key, change] of Object.entries(configChanges)) {
        changes[`config.${key}`] = change;
      }

      if (Object.keys(changes).length > 0) {
        modifiedNodes.push({ id, changes });
      }
    }

    // Edges: compare as sets using "from→to" key (ignoring condition for simplicity)
    const edgeKey = (e: WorkflowEdge) => `${e.from}→${e.to}`;

    const edgesA = new Map<string, WorkflowEdge>(versionA.edges.map((e) => [edgeKey(e), e]));
    const edgesB = new Map<string, WorkflowEdge>(versionB.edges.map((e) => [edgeKey(e), e]));

    const addedEdges: { from: string; to: string }[] = [];
    const removedEdges: { from: string; to: string }[] = [];

    for (const [key, edge] of edgesB) {
      if (!edgesA.has(key)) {
        addedEdges.push({ from: edge.from, to: edge.to });
      }
    }

    for (const [key, edge] of edgesA) {
      if (!edgesB.has(key)) {
        removedEdges.push({ from: edge.from, to: edge.to });
      }
    }

    return { addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges };
  }

  private diffObjects(
    objA: Record<string, any>,
    objB: Record<string, any>,
  ): Record<string, { from: any; to: any }> {
    const changes: Record<string, { from: any; to: any }> = {};

    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of allKeys) {
      const valA = objA[key];
      const valB = objB[key];
      if (JSON.stringify(valA) !== JSON.stringify(valB)) {
        changes[key] = { from: valA, to: valB };
      }
    }

    return changes;
  }
}
