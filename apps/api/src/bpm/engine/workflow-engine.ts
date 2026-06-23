import { Injectable, HttpStatus } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/filters/business-exception.filter';
import { ApprovalService } from '../approval.service';
import { RuleEngine } from './rule-engine';
import { ActionExecutor } from './action-executor';

export interface WorkflowNode {
  id: string;
  type: 'START' | 'END' | 'APPROVAL' | 'CONDITION' | 'ACTION' | 'WAIT';
  config: Record<string, any>;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

@Injectable()
export class WorkflowEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly approvalService: ApprovalService,
    private readonly ruleEngine: RuleEngine,
    private readonly actionExecutor: ActionExecutor,
  ) {}

  async startWorkflow(
    companyId: string,
    workflowId: string,
    entityType: string,
    entityId: string,
    variables?: Record<string, any>,
  ) {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id: workflowId, companyId, status: 'ACTIVE' },
    });
    if (!workflow) {
      throw new BusinessException('Workflow não encontrado ou inativo', HttpStatus.NOT_FOUND);
    }

    const activeVersion = await this.prisma.workflowVersion.findFirst({
      where: { workflowId, isActive: true },
    });
    if (!activeVersion) {
      throw new BusinessException(
        'Nenhuma versão ativa para este workflow',
        HttpStatus.BAD_REQUEST,
      );
    }

    const definition = activeVersion.definition as unknown as WorkflowDefinition;
    const startNode = definition.nodes.find((n) => n.type === 'START');
    if (!startNode) {
      throw new BusinessException(
        'Definição de workflow inválida: nó START não encontrado',
        HttpStatus.BAD_REQUEST,
      );
    }

    const instance = await this.prisma.workflowInstance.create({
      data: {
        companyId,
        workflowId,
        entityType,
        entityId,
        status: 'RUNNING',
        currentNodeId: startNode.id,
        variables: variables ?? {},
      },
    });

    // Record history for start
    await this.prisma.workflowHistory.create({
      data: {
        instanceId: instance.id,
        fromNodeId: undefined,
        toNodeId: startNode.id,
        action: 'AUTO',
        metadata: { event: 'workflow_started' },
      },
    });

    // Auto-advance from START node
    return this.advanceNode(instance.id);
  }

  async advanceNode(instanceId: string, action?: string, performedBy?: string) {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: { workflow: { include: { versions: { where: { isActive: true } } } } },
    });
    if (!instance) {
      throw new BusinessException('Instância não encontrada', HttpStatus.NOT_FOUND);
    }
    if (!['RUNNING'].includes(instance.status)) {
      throw new BusinessException(
        `Instância não pode ser avançada no status ${instance.status}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const activeVersion = instance.workflow.versions[0];
    if (!activeVersion) {
      throw new BusinessException('Versão ativa não encontrada', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const definition = activeVersion.definition as unknown as WorkflowDefinition;
    const currentNode = definition.nodes.find((n) => n.id === instance.currentNodeId);
    if (!currentNode) {
      throw new BusinessException('Nó atual não encontrado na definição', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return this.processNode(instance, currentNode, definition, action, performedBy);
  }

  async processNode(
    instance: any,
    node: WorkflowNode,
    definition: WorkflowDefinition,
    action?: string,
    performedBy?: string,
  ) {
    const variables = (instance.variables as Record<string, any>) ?? {};

    switch (node.type) {
      case 'START': {
        const nextNode = this.getNextNode(definition, node.id);
        if (nextNode) {
          await this.moveToNode(instance, node, nextNode, 'AUTO', performedBy);
          return this.processNode(instance, nextNode, definition, action, performedBy);
        }
        break;
      }

      case 'END': {
        await this.prisma.workflowInstance.update({
          where: { id: instance.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await this.prisma.workflowHistory.create({
          data: {
            instanceId: instance.id,
            fromNodeId: instance.currentNodeId,
            toNodeId: node.id,
            action: 'AUTO',
            metadata: { event: 'workflow_completed' },
            performedBy,
          },
        });
        this.eventEmitter.emit('workflow.completed', {
          instanceId: instance.id,
          entityType: instance.entityType,
          entityId: instance.entityId,
        });
        return { status: 'COMPLETED', instanceId: instance.id };
      }

      case 'APPROVAL': {
        // If action is APPROVE, this means all approvals were granted and we should advance
        // past this node to the next one (called by ApprovalService after last approval)
        if (action === 'APPROVE') {
          const pendingCount = await this.prisma.approvalRequest.findFirst({
            where: { instanceId: instance.id, status: 'PENDING' },
          });
          if (!pendingCount) {
            // All approvals done — advance to next node
            const nextNode = this.getNextNode(definition, node.id);
            if (nextNode) {
              await this.moveToNode(instance, node, nextNode, 'APPROVE', performedBy);
              return this.processNode(instance, nextNode, definition, action, performedBy);
            }
            break;
          }
        }

        // Look up approval matrix for this entity type
        const level = node.config?.level ?? 1;
        const matrices = await this.approvalService.getRequiredApprovals(
          instance.companyId,
          instance.entityType,
          variables,
        );

        const levelMatrices = matrices.filter((m) => m.level === level);

        if (levelMatrices.length === 0) {
          // No matrix found — auto-advance
          const nextNode = this.getNextNode(definition, node.id);
          if (nextNode) {
            await this.moveToNode(instance, node, nextNode, 'AUTO', performedBy);
            return this.processNode(instance, nextNode, definition, action, performedBy);
          }
        } else {
          // Create approval requests for each role at each level
          const allLevels = [...new Set(matrices.map((m) => m.level))].sort();
          for (const lvl of allLevels) {
            const lvlMatrices = matrices.filter((m) => m.level === lvl);
            for (const matrix of lvlMatrices) {
              for (const role of matrix.approverRoles) {
                await this.prisma.approvalRequest.create({
                  data: {
                    instanceId: instance.id,
                    level: lvl,
                    approverRole: role,
                    status: 'PENDING',
                  },
                });
              }
            }
          }

          await this.prisma.workflowInstance.update({
            where: { id: instance.id },
            data: {
              status: 'WAITING_APPROVAL',
              currentNodeId: node.id,
            },
          });
          await this.prisma.workflowHistory.create({
            data: {
              instanceId: instance.id,
              fromNodeId: instance.currentNodeId,
              toNodeId: node.id,
              action: 'AUTO',
              metadata: { event: 'waiting_approval', level },
              performedBy,
            },
          });
          return { status: 'WAITING_APPROVAL', instanceId: instance.id };
        }
        break;
      }

      case 'CONDITION': {
        let conditionResult = false;

        // Prefer JsonLogic rule if present, fall back to legacy string expression
        if (node.config?.rule) {
          try {
            const ruleResult = this.ruleEngine.evaluate(node.config.rule, variables);
            conditionResult = Boolean(ruleResult);
          } catch {
            conditionResult = false;
          }
        } else if (node.config?.expression) {
          conditionResult = this.evaluateCondition(node.config.expression as string, variables);
        }

        const nextNode = this.getNextNode(definition, node.id, conditionResult);
        if (nextNode) {
          await this.moveToNode(instance, node, nextNode, 'AUTO', performedBy);
          return this.processNode(instance, nextNode, definition, action, performedBy);
        }
        break;
      }

      case 'ACTION': {
        const actionType = node.config?.actionType as string;
        if (actionType) {
          // Execute via ActionExecutor (plugin system)
          await this.actionExecutor.execute({
            companyId: instance.companyId,
            instanceId: instance.id,
            nodeId: node.id,
            config: node.config ?? {},
            variables,
          });

          // Also emit event for legacy/external listeners
          this.eventEmitter.emit(`workflow.action.${actionType}`, {
            instanceId: instance.id,
            entityType: instance.entityType,
            entityId: instance.entityId,
            variables,
            config: node.config,
          });
        }
        const nextNode = this.getNextNode(definition, node.id);
        if (nextNode) {
          await this.moveToNode(instance, node, nextNode, 'AUTO', performedBy);
          return this.processNode(instance, nextNode, definition, action, performedBy);
        }
        break;
      }

      case 'WAIT': {
        await this.prisma.workflowInstance.update({
          where: { id: instance.id },
          data: { currentNodeId: node.id },
        });
        await this.prisma.workflowHistory.create({
          data: {
            instanceId: instance.id,
            fromNodeId: instance.currentNodeId,
            toNodeId: node.id,
            action: 'AUTO',
            metadata: { event: 'waiting_external_trigger' },
            performedBy,
          },
        });
        return { status: 'RUNNING', currentNodeId: node.id, instanceId: instance.id };
      }
    }

    return { status: instance.status, instanceId: instance.id };
  }

  evaluateCondition(expression: string, variables: Record<string, any>): boolean {
    // Supported operators: >, <, >=, <=, ==, !=
    const operators = ['>=', '<=', '!=', '>', '<', '=='];
    for (const op of operators) {
      const idx = expression.indexOf(op);
      if (idx === -1) continue;

      const left = expression.substring(0, idx).trim();
      const right = expression.substring(idx + op.length).trim();

      // Resolve left side — support dot notation for variables
      let leftVal: any = this.resolveValue(left, variables);
      let rightVal: any = this.resolveValue(right, variables);

      // Try numeric comparison
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
        case '==': return leftVal == rightVal;
        case '!=': return leftVal != rightVal;
      }
    }
    return false;
  }

  private resolveValue(token: string, variables: Record<string, any>): any {
    // Check if it's a variables.xxx reference
    if (token.startsWith('variables.')) {
      const key = token.replace('variables.', '');
      return variables[key];
    }
    // Try to parse as number
    const num = parseFloat(token);
    if (!isNaN(num)) return num;
    // Return as string (strip quotes if present)
    return token.replace(/^['"]|['"]$/g, '');
  }

  getNextNode(
    definition: WorkflowDefinition,
    currentNodeId: string,
    conditionResult?: boolean,
  ): WorkflowNode | null {
    const edges = definition.edges.filter((e) => e.from === currentNodeId);

    if (edges.length === 0) return null;

    // If condition edges exist, follow the matching one
    const trueEdge = edges.find((e) => e.condition === 'true');
    const falseEdge = edges.find((e) => e.condition === 'false');

    let targetEdge: WorkflowEdge | undefined;
    if (conditionResult !== undefined && (trueEdge || falseEdge)) {
      targetEdge = conditionResult ? trueEdge : falseEdge;
    } else {
      // Take the first unconditional edge
      targetEdge = edges.find((e) => !e.condition) ?? edges[0];
    }

    if (!targetEdge) return null;

    return definition.nodes.find((n) => n.id === targetEdge!.to) ?? null;
  }

  private async moveToNode(
    instance: any,
    fromNode: WorkflowNode,
    toNode: WorkflowNode,
    action: string,
    performedBy?: string,
  ) {
    await this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: { currentNodeId: toNode.id },
    });
    await this.prisma.workflowHistory.create({
      data: {
        instanceId: instance.id,
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        action,
        performedBy,
      },
    });
    // Update the local instance reference for further processing
    instance.currentNodeId = toNode.id;
  }
}
