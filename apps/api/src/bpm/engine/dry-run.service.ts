import { Injectable } from '@nestjs/common';
import { WorkflowDefinition, WorkflowNode } from './workflow-engine';
import { RuleEngine } from './rule-engine';

export interface DryRunPathStep {
  nodeId: string;
  type: string;
  action?: string;
}

export interface DryRunResult {
  success: boolean;
  path: DryRunPathStep[];
  errors: string[];
  variables: Record<string, any>;
}

const MAX_STEPS = 100; // guard against infinite loops

@Injectable()
export class DryRunService {
  constructor(private readonly ruleEngine: RuleEngine) {}

  dryRun(definition: WorkflowDefinition, variables: Record<string, any> = {}): DryRunResult {
    const path: DryRunPathStep[] = [];
    const errors: string[] = [];
    const vars = { ...variables };

    const startNode = definition.nodes.find((n) => n.type === 'START');
    if (!startNode) {
      return {
        success: false,
        path,
        errors: ['Nó START não encontrado na definição'],
        variables: vars,
      };
    }

    let currentNode: WorkflowNode | undefined = startNode;
    let steps = 0;

    while (currentNode) {
      if (steps++ > MAX_STEPS) {
        errors.push('Limite de passos excedido — possível loop infinito detectado');
        return { success: false, path, errors, variables: vars };
      }

      const step: DryRunPathStep = { nodeId: currentNode.id, type: currentNode.type };

      switch (currentNode.type) {
        case 'START': {
          path.push(step);
          currentNode = this.getNextNode(definition, currentNode.id);
          break;
        }

        case 'END': {
          path.push(step);
          return { success: true, path, errors, variables: vars };
        }

        case 'ACTION': {
          const actionType = currentNode.config?.actionType as string | undefined;
          step.action = actionType;
          path.push(step);
          currentNode = this.getNextNode(definition, currentNode.id);
          break;
        }

        case 'CONDITION': {
          let conditionResult = false;
          try {
            if (currentNode.config?.rule) {
              conditionResult = Boolean(this.ruleEngine.evaluate(currentNode.config.rule, vars));
            } else if (currentNode.config?.expression) {
              conditionResult = this.evaluateSimpleExpression(
                currentNode.config.expression as string,
                vars,
              );
            }
          } catch (err: any) {
            errors.push(`Erro ao avaliar condição no nó "${currentNode.id}": ${err?.message}`);
            conditionResult = false;
          }
          step.action = conditionResult ? 'true' : 'false';
          path.push(step);
          currentNode = this.getNextNodeConditional(definition, currentNode.id, conditionResult);
          break;
        }

        case 'APPROVAL': {
          const level = currentNode.config?.level ?? 1;
          step.action = `APPROVAL_LEVEL_${level}`;
          path.push(step);
          // In dry-run, approvals are auto-approved — advance to next
          currentNode = this.getNextNode(definition, currentNode.id);
          break;
        }

        case 'WAIT': {
          step.action = 'WAIT_TRIGGER';
          path.push(step);
          // In dry-run, WAIT stops execution here
          return { success: true, path, errors, variables: vars };
        }

        default: {
          errors.push(`Tipo de nó desconhecido: "${currentNode.type}"`);
          path.push(step);
          currentNode = undefined;
        }
      }
    }

    // If we exit the loop without hitting END
    if (path.length > 0 && path[path.length - 1]?.type !== 'END') {
      errors.push('Fluxo encerrado sem atingir nó END');
    }

    return { success: errors.length === 0, path, errors, variables: vars };
  }

  private getNextNode(
    definition: WorkflowDefinition,
    nodeId: string,
  ): WorkflowNode | undefined {
    const edge = definition.edges.find((e) => e.from === nodeId && !e.condition);
    if (!edge) {
      // Fallback: any edge from this node (non-conditional)
      const anyEdge = definition.edges.find((e) => e.from === nodeId);
      if (!anyEdge) return undefined;
      return definition.nodes.find((n) => n.id === anyEdge.to);
    }
    return definition.nodes.find((n) => n.id === edge.to);
  }

  private getNextNodeConditional(
    definition: WorkflowDefinition,
    nodeId: string,
    conditionResult: boolean,
  ): WorkflowNode | undefined {
    const conditionStr = conditionResult ? 'true' : 'false';
    const edge = definition.edges.find(
      (e) => e.from === nodeId && e.condition === conditionStr,
    );
    if (!edge) {
      // Fallback to unconditional edge
      return this.getNextNode(definition, nodeId);
    }
    return definition.nodes.find((n) => n.id === edge.to);
  }

  private evaluateSimpleExpression(expression: string, variables: Record<string, any>): boolean {
    const operators = ['>=', '<=', '!=', '>', '<', '=='];
    for (const op of operators) {
      const idx = expression.indexOf(op);
      if (idx === -1) continue;

      const left = expression.substring(0, idx).trim();
      const right = expression.substring(idx + op.length).trim();

      let leftVal: any = this.resolveToken(left, variables);
      let rightVal: any = this.resolveToken(right, variables);

      const leftNum = parseFloat(String(leftVal));
      const rightNum = parseFloat(String(rightVal));
      if (!isNaN(leftNum) && !isNaN(rightNum)) {
        leftVal = leftNum;
        rightVal = rightNum;
      }

      switch (op) {
        case '>':  return leftVal > rightVal;
        case '<':  return leftVal < rightVal;
        case '>=': return leftVal >= rightVal;
        case '<=': return leftVal <= rightVal;
        case '==': return leftVal == rightVal; // eslint-disable-line eqeqeq
        case '!=': return leftVal != rightVal; // eslint-disable-line eqeqeq
      }
    }
    return false;
  }

  private resolveToken(token: string, variables: Record<string, any>): any {
    if (token.startsWith('variables.')) {
      return variables[token.replace('variables.', '')];
    }
    const num = parseFloat(token);
    if (!isNaN(num)) return num;
    return token.replace(/^['"]|['"]$/g, '');
  }
}
