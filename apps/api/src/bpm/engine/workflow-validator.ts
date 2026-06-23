import { Injectable } from '@nestjs/common';
import { WorkflowDefinition } from './workflow-engine';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class WorkflowValidator {
  validate(definition: WorkflowDefinition): ValidationResult {
    const errors: string[] = [];

    if (!definition || !Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) {
      return { valid: false, errors: ['Definição de workflow inválida: nodes e edges são obrigatórios'] };
    }

    const nodeIds = new Set(definition.nodes.map((n) => n.id));

    // 1. Exactly one START node
    const startNodes = definition.nodes.filter((n) => n.type === 'START');
    if (startNodes.length === 0) {
      errors.push('O workflow deve ter exatamente um nó START');
    } else if (startNodes.length > 1) {
      errors.push(`O workflow tem ${startNodes.length} nós START — deve ter exatamente um`);
    }

    // 2. At least one END node
    const endNodes = definition.nodes.filter((n) => n.type === 'END');
    if (endNodes.length === 0) {
      errors.push('O workflow deve ter pelo menos um nó END');
    }

    // 3. All edges reference valid node IDs
    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.from)) {
        errors.push(`Edge referencia nó de origem inválido: "${edge.from}"`);
      }
      if (!nodeIds.has(edge.to)) {
        errors.push(`Edge referencia nó de destino inválido: "${edge.to}"`);
      }
    }

    // 4. CONDITION nodes must have at least 2 outgoing edges
    const conditionNodes = definition.nodes.filter((n) => n.type === 'CONDITION');
    for (const node of conditionNodes) {
      const outgoing = definition.edges.filter((e) => e.from === node.id);
      if (outgoing.length < 2) {
        errors.push(
          `Nó CONDITION "${node.id}" deve ter pelo menos 2 edges de saída (tem ${outgoing.length})`,
        );
      }
    }

    // 5. No orphan nodes (unreachable from START)
    if (startNodes.length === 1) {
      const reachable = this.findReachableNodes(definition, startNodes[0].id);
      for (const node of definition.nodes) {
        if (!reachable.has(node.id)) {
          errors.push(`Nó "${node.id}" (tipo ${node.type}) é inalcançável a partir do START`);
        }
      }
    }

    // 6. No infinite loops (simple cycle detection via DFS)
    if (errors.length === 0) {
      const cycles = this.detectCycles(definition);
      for (const cycle of cycles) {
        errors.push(`Ciclo detectado: ${cycle.join(' → ')}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private findReachableNodes(definition: WorkflowDefinition, startId: string): Set<string> {
    const reachable = new Set<string>();
    const queue: string[] = [startId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      const outgoing = definition.edges.filter((e) => e.from === current);
      for (const edge of outgoing) {
        if (!reachable.has(edge.to)) {
          queue.push(edge.to);
        }
      }
    }

    return reachable;
  }

  private detectCycles(definition: WorkflowDefinition): string[][] {
    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const node of definition.nodes) {
      adj.set(node.id, []);
    }
    for (const edge of definition.edges) {
      const neighbors = adj.get(edge.from);
      if (neighbors) neighbors.push(edge.to);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeId: string, path: string[]) => {
      if (inStack.has(nodeId)) {
        // Found a cycle — extract the cycle portion
        const cycleStart = path.indexOf(nodeId);
        cycles.push([...path.slice(cycleStart), nodeId]);
        return;
      }
      if (visited.has(nodeId)) return;

      visited.add(nodeId);
      inStack.add(nodeId);
      path.push(nodeId);

      const neighbors = adj.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        dfs(neighbor, path);
      }

      path.pop();
      inStack.delete(nodeId);
    };

    for (const node of definition.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id, []);
      }
    }

    return cycles;
  }
}
