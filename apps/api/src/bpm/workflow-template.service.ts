import { Injectable, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/filters/business-exception.filter';
import { WorkflowDefinition } from './engine/workflow-engine';

// ─── Built-in templates ───────────────────────────────────────────────────────

const BUILTIN_TEMPLATES: Array<{
  id: string;
  name: string;
  description: string;
  entityType: string;
  category: string;
  isBuiltIn: boolean;
  definition: WorkflowDefinition;
  createdAt: Date;
}> = [
  {
    id: 'builtin-po-approval',
    name: 'Aprovação de PO',
    description: 'Fluxo padrão de aprovação de ordens de compra com verificação de valor',
    entityType: 'PURCHASE_ORDER',
    category: 'APPROVAL',
    isBuiltIn: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    definition: {
      nodes: [
        { id: 'start', type: 'START', config: {} },
        {
          id: 'check-amount',
          type: 'CONDITION',
          config: { rule: { '>': [{ var: 'totalAmount' }, 10000] } },
        },
        { id: 'approval-l1', type: 'APPROVAL', config: { level: 1 } },
        { id: 'approval-l2', type: 'APPROVAL', config: { level: 2 } },
        {
          id: 'notify',
          type: 'ACTION',
          config: { actionType: 'SEND_EMAIL', subject: 'PO Aprovada' },
        },
        { id: 'end', type: 'END', config: {} },
      ],
      edges: [
        { from: 'start', to: 'check-amount' },
        { from: 'check-amount', to: 'approval-l1', condition: 'false' },
        { from: 'check-amount', to: 'approval-l2', condition: 'true' },
        { from: 'approval-l1', to: 'notify' },
        { from: 'approval-l2', to: 'notify' },
        { from: 'notify', to: 'end' },
      ],
    },
  },
  {
    id: 'builtin-sales-flow',
    name: 'Fluxo de Venda',
    description: 'Fluxo padrão de vendas com verificação de crédito e reserva de estoque',
    entityType: 'SALES_ORDER',
    category: 'SALES',
    isBuiltIn: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    definition: {
      nodes: [
        { id: 'start', type: 'START', config: {} },
        {
          id: 'credit-check',
          type: 'CONDITION',
          config: { rule: { '<=': [{ var: 'totalAmount' }, { var: 'creditLimit' }] } },
        },
        { id: 'approval', type: 'APPROVAL', config: { level: 1 } },
        {
          id: 'reserve-stock',
          type: 'ACTION',
          config: { actionType: 'RESERVE_STOCK' },
        },
        { id: 'end', type: 'END', config: {} },
      ],
      edges: [
        { from: 'start', to: 'credit-check' },
        { from: 'credit-check', to: 'reserve-stock', condition: 'true' },
        { from: 'credit-check', to: 'approval', condition: 'false' },
        { from: 'approval', to: 'reserve-stock' },
        { from: 'reserve-stock', to: 'end' },
      ],
    },
  },
  {
    id: 'builtin-supplier-onboarding',
    name: 'Onboarding de Fornecedor',
    description: 'Fluxo de cadastro e boas-vindas de novos fornecedores',
    entityType: 'SUPPLIER',
    category: 'ONBOARDING',
    isBuiltIn: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    definition: {
      nodes: [
        { id: 'start', type: 'START', config: {} },
        {
          id: 'notify-team',
          type: 'ACTION',
          config: { actionType: 'CREATE_NOTIFICATION', message: 'Novo fornecedor aguarda cadastro' },
        },
        { id: 'manager-approval', type: 'APPROVAL', config: { level: 1 } },
        {
          id: 'send-welcome',
          type: 'ACTION',
          config: { actionType: 'SEND_EMAIL', subject: 'Bem-vindo à GDR Reboques' },
        },
        { id: 'end', type: 'END', config: {} },
      ],
      edges: [
        { from: 'start', to: 'notify-team' },
        { from: 'notify-team', to: 'manager-approval' },
        { from: 'manager-approval', to: 'send-welcome' },
        { from: 'send-welcome', to: 'end' },
      ],
    },
  },
];

@Injectable()
export class WorkflowTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  getBuiltInTemplates(category?: string) {
    if (category) {
      return BUILTIN_TEMPLATES.filter((t) => t.category === category);
    }
    return BUILTIN_TEMPLATES;
  }

  async findAll(category?: string) {
    const dbTemplates = await this.prisma.workflowTemplate.findMany({
      where: category ? { category } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    const builtIn = this.getBuiltInTemplates(category);
    return [...builtIn, ...dbTemplates];
  }

  async findOne(id: string) {
    // Check built-in templates first
    const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
    if (builtin) return builtin;

    const template = await this.prisma.workflowTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new BusinessException('Template não encontrado', HttpStatus.NOT_FOUND);
    }
    return template;
  }

  async createFromTemplate(companyId: string, templateId: string, workflowName: string) {
    const template = await this.findOne(templateId);

    const existing = await this.prisma.workflow.findFirst({
      where: { companyId, name: workflowName },
    });
    if (existing) {
      throw new BusinessException(
        `Workflow com nome "${workflowName}" já existe`,
        HttpStatus.CONFLICT,
      );
    }

    const workflow = await this.prisma.workflow.create({
      data: {
        companyId,
        name: workflowName,
        entityType: template.entityType,
        description: template.description ?? undefined,
      },
    });

    const version = await this.prisma.workflowVersion.create({
      data: {
        workflowId: workflow.id,
        version: 1,
        definition: template.definition as any,
        isActive: false,
      },
    });

    return { workflow, version };
  }
}
