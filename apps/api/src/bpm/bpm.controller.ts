import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { WorkflowService } from './workflow.service';
import { WorkflowEngine, WorkflowDefinition } from './engine/workflow-engine';
import { ApprovalService } from './approval.service';
import { SlaService } from './sla.service';
import { NotificationService } from './notification.service';
import { TaskAssignmentService } from './task-assignment.service';
import { EmailTemplateService, CreateEmailTemplateDto, UpdateEmailTemplateDto } from './email-template.service';
import { WorkflowTemplateService } from './workflow-template.service';
import { DryRunService } from './engine/dry-run.service';
import { WorkflowDiffService } from './workflow-diff.service';
import { WorkflowValidator } from './engine/workflow-validator';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { CreateWorkflowVersionDto } from './dto/create-workflow-version.dto';
import { StartWorkflowDto } from './dto/start-workflow.dto';
import { CreateApprovalMatrixDto } from './dto/create-approval-matrix.dto';
import { CreateSlaDefinitionDto } from './dto/create-sla-definition.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { AdvanceInstanceDto } from './dto/advance-instance.dto';
import { BusinessException } from '../common/filters/business-exception.filter';

// Decorator stubs — provided by common/decorators
declare const Roles: (...roles: string[]) => MethodDecorator & ClassDecorator;
declare const CurrentUser: () => ParameterDecorator;

interface AuthUser {
  userId: string;
  companyId: string;
  role: string;
}

@ApiTags('BPM')
@ApiBearerAuth()
@Controller('bpm')
export class BpmController {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowEngine: WorkflowEngine,
    private readonly approvalService: ApprovalService,
    private readonly slaService: SlaService,
    private readonly notificationService: NotificationService,
    private readonly taskAssignmentService: TaskAssignmentService,
    private readonly emailTemplateService: EmailTemplateService,
    private readonly workflowTemplateService: WorkflowTemplateService,
    private readonly dryRunService: DryRunService,
    private readonly workflowDiffService: WorkflowDiffService,
    private readonly workflowValidator: WorkflowValidator,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Workflows ──────────────────────────────────────────────────────────────

  @Post('workflows')
  @ApiOperation({ summary: 'Criar workflow' })
  createWorkflow(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkflowDto,
  ) {
    return this.workflowService.create(user.companyId, dto);
  }

  @Get('workflows')
  @ApiOperation({ summary: 'Listar workflows' })
  @ApiQuery({ name: 'entityType', required: false })
  findWorkflows(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType?: string,
  ) {
    return this.workflowService.findAll(user.companyId, entityType);
  }

  @Get('workflows/:id')
  @ApiOperation({ summary: 'Buscar workflow por ID' })
  findWorkflow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflowService.findOne(user.companyId, id);
  }

  @Patch('workflows/:id')
  @ApiOperation({ summary: 'Atualizar workflow' })
  updateWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateWorkflowDto>,
  ) {
    return this.workflowService.update(user.companyId, id, dto);
  }

  @Patch('workflows/:id/archive')
  @ApiOperation({ summary: 'Arquivar workflow' })
  archiveWorkflow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.workflowService.archive(user.companyId, id);
  }

  @Post('workflows/:id/versions')
  @ApiOperation({ summary: 'Criar nova versão do workflow' })
  createVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateWorkflowVersionDto,
  ) {
    return this.workflowService.createVersion(user.companyId, id, dto);
  }

  @Post('workflows/:id/versions/:vId/publish')
  @ApiOperation({ summary: 'Publicar versão do workflow' })
  publishVersion(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('vId') vId: string,
  ) {
    return this.workflowService.publishVersion(user.companyId, id, vId);
  }

  @Post('workflows/:id/start')
  @ApiOperation({ summary: 'Iniciar instância de workflow' })
  startWorkflow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: StartWorkflowDto,
  ) {
    return this.workflowEngine.startWorkflow(
      user.companyId,
      id,
      dto.entityType,
      dto.entityId,
      dto.variables,
    );
  }

  // ─── Instances ──────────────────────────────────────────────────────────────

  @Get('instances')
  @ApiOperation({ summary: 'Listar instâncias de workflow' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'status', required: false })
  findInstances(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType?: string,
    @Query('status') status?: string,
  ) {
    return this.prisma.workflowInstance.findMany({
      where: {
        companyId: user.companyId,
        ...(entityType ? { entityType } : {}),
        ...(status ? { status: status as any } : {}),
      },
      include: {
        workflow: { select: { name: true, entityType: true } },
        _count: { select: { approvals: true, history: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  @Get('instances/:id')
  @ApiOperation({ summary: 'Detalhe da instância com histórico' })
  async findInstance(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.prisma.workflowInstance.findFirst({
      where: { id, companyId: user.companyId },
      include: {
        workflow: true,
        history: { orderBy: { createdAt: 'asc' } },
        approvals: { orderBy: [{ level: 'asc' }, { createdAt: 'asc' }] },
      },
    });
  }

  @Post('instances/:id/advance')
  @ApiOperation({ summary: 'Avançar nó da instância' })
  @HttpCode(HttpStatus.OK)
  advanceInstance(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AdvanceInstanceDto,
  ) {
    return this.workflowEngine.advanceNode(id, dto.action, dto.performedBy ?? user.userId);
  }

  @Post('instances/:id/approve')
  @ApiOperation({ summary: 'Aprovar instância' })
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.approvalService.approve(id, user.userId, user.role, dto.comments);
  }

  @Post('instances/:id/reject')
  @ApiOperation({ summary: 'Rejeitar instância' })
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApproveRequestDto,
  ) {
    return this.approvalService.reject(id, user.userId, user.role, dto.comments);
  }

  // ─── Approval Matrices ──────────────────────────────────────────────────────

  @Post('approval-matrices')
  @ApiOperation({ summary: 'Criar matriz de aprovação' })
  createMatrix(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateApprovalMatrixDto,
  ) {
    return this.approvalService.createMatrix(user.companyId, dto);
  }

  @Get('approval-matrices')
  @ApiOperation({ summary: 'Listar matrizes de aprovação' })
  @ApiQuery({ name: 'entityType', required: false })
  findMatrices(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType?: string,
  ) {
    return this.approvalService.findMatrices(user.companyId, entityType);
  }

  @Patch('approval-matrices/:id')
  @ApiOperation({ summary: 'Atualizar matriz de aprovação' })
  updateMatrix(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateApprovalMatrixDto>,
  ) {
    return this.approvalService.updateMatrix(user.companyId, id, dto);
  }

  @Delete('approval-matrices/:id')
  @ApiOperation({ summary: 'Excluir matriz de aprovação' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMatrix(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.approvalService.deleteMatrix(user.companyId, id);
  }

  // ─── SLA Definitions ────────────────────────────────────────────────────────

  @Post('sla-definitions')
  @ApiOperation({ summary: 'Criar definição de SLA' })
  createSla(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSlaDefinitionDto,
  ) {
    return this.slaService.createDefinition(user.companyId, dto);
  }

  @Get('sla-definitions')
  @ApiOperation({ summary: 'Listar definições de SLA' })
  @ApiQuery({ name: 'entityType', required: false })
  findSlaDefinitions(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType?: string,
  ) {
    return this.slaService.findDefinitions(user.companyId, entityType);
  }

  @Patch('sla-definitions/:id')
  @ApiOperation({ summary: 'Atualizar definição de SLA' })
  updateSla(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: Partial<CreateSlaDefinitionDto>,
  ) {
    return this.slaService.updateDefinition(user.companyId, id, dto);
  }

  @Delete('sla-definitions/:id')
  @ApiOperation({ summary: 'Excluir definição de SLA' })
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSla(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.slaService.deleteDefinition(user.companyId, id);
  }

  // ─── SLA Breaches ───────────────────────────────────────────────────────────

  @Get('sla-breaches')
  @ApiOperation({ summary: 'Listar violações de SLA' })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'resolved', required: false })
  findBreaches(
    @CurrentUser() user: AuthUser,
    @Query('entityType') entityType?: string,
    @Query('resolved') resolved?: string,
  ) {
    return this.slaService.findBreaches(user.companyId, {
      entityType,
      resolved: resolved !== undefined ? resolved === 'true' : undefined,
    });
  }

  @Patch('sla-breaches/:id/resolve')
  @ApiOperation({ summary: 'Resolver violação de SLA' })
  resolveBreach(@Param('id') id: string) {
    return this.slaService.resolveBreach(id);
  }

  // ─── Notifications ──────────────────────────────────────────────────────────

  @Get('notifications')
  @ApiOperation({ summary: 'Listar notificações' })
  @ApiQuery({ name: 'unread', required: false })
  findNotifications(
    @CurrentUser() user: AuthUser,
    @Query('unread') unread?: string,
  ) {
    return this.notificationService.findAll(
      user.companyId,
      user.userId,
      unread === 'true',
    );
  }

  @Get('notifications/count')
  @ApiOperation({ summary: 'Contagem de notificações não lidas' })
  async getUnreadCount(@CurrentUser() user: AuthUser) {
    const count = await this.notificationService.getUnreadCount(user.companyId, user.userId);
    return { count };
  }

  @Patch('notifications/:id/read')
  @ApiOperation({ summary: 'Marcar notificação como lida' })
  markAsRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notificationService.markAsRead(user.companyId, id);
  }

  @Post('notifications/read-all')
  @ApiOperation({ summary: 'Marcar todas as notificações como lidas' })
  @HttpCode(HttpStatus.OK)
  markAllAsRead(@CurrentUser() user: AuthUser) {
    return this.notificationService.markAllAsRead(user.companyId, user.userId);
  }

  // ─── Email Templates ────────────────────────────────────────────────────────

  @Post('email-templates')
  @ApiOperation({ summary: 'Criar template de email' })
  createEmailTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEmailTemplateDto,
  ) {
    return this.emailTemplateService.create(user.companyId, dto);
  }

  @Get('email-templates')
  @ApiOperation({ summary: 'Listar templates de email' })
  @ApiQuery({ name: 'activeOnly', required: false })
  findEmailTemplates(
    @CurrentUser() user: AuthUser,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.emailTemplateService.findAll(user.companyId, activeOnly === 'true');
  }

  @Get('email-templates/:id')
  @ApiOperation({ summary: 'Buscar template de email por ID' })
  findEmailTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.emailTemplateService.findOne(user.companyId, id);
  }

  @Patch('email-templates/:id')
  @ApiOperation({ summary: 'Atualizar template de email' })
  updateEmailTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return this.emailTemplateService.update(user.companyId, id, dto);
  }

  @Delete('email-templates/:id')
  @ApiOperation({ summary: 'Excluir template de email' })
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEmailTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.emailTemplateService.remove(user.companyId, id);
  }

  // ─── Task Assignments ───────────────────────────────────────────────────────

  @Get('tasks/my')
  @ApiOperation({ summary: 'Minhas tarefas (inbox)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'priority', required: false })
  findMyTasks(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('priority') priority?: string,
  ) {
    return this.taskAssignmentService.findMyTasks(
      user.companyId,
      user.userId,
      user.role,
      { status, entityType, priority },
    );
  }

  @Get('tasks/my/summary')
  @ApiOperation({ summary: 'Resumo do inbox (contagens por tipo e prioridade)' })
  getInboxSummary(@CurrentUser() user: AuthUser) {
    return this.taskAssignmentService.getInboxSummary(
      user.companyId,
      user.userId,
      user.role,
    );
  }

  @Get('tasks')
  @ApiOperation({ summary: 'Listar todas as tarefas (visão admin)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'priority', required: false })
  findAllTasks(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('priority') priority?: string,
  ) {
    return this.taskAssignmentService.findAll(user.companyId, {
      status,
      entityType,
      priority,
    });
  }

  @Post('tasks/:id/start')
  @ApiOperation({ summary: 'Iniciar trabalho na tarefa' })
  @HttpCode(HttpStatus.OK)
  startTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskAssignmentService.startTask(user.companyId, id, user.userId);
  }

  @Post('tasks/:id/complete')
  @ApiOperation({ summary: 'Concluir tarefa' })
  @HttpCode(HttpStatus.OK)
  completeTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskAssignmentService.completeTask(
      user.companyId,
      id,
      user.userId,
    );
  }

  @Post('tasks/:id/cancel')
  @ApiOperation({ summary: 'Cancelar tarefa' })
  @HttpCode(HttpStatus.OK)
  cancelTask(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.taskAssignmentService.cancelTask(user.companyId, id);
  }

  @Post('tasks/check-overdue')
  @ApiOperation({ summary: 'Marcar tarefas vencidas como OVERDUE (trigger manual)' })
  @HttpCode(HttpStatus.OK)
  async checkOverdue() {
    const count = await this.taskAssignmentService.markOverdue();
    return { marked: count };
  }

  // ─── Workflow Actions ───────────────────────────────────────────────────────

  @Get('actions')
  @ApiOperation({ summary: 'Listar ações de uma instância' })
  @ApiQuery({ name: 'instanceId', required: true })
  findActions(
    @CurrentUser() user: AuthUser,
    @Query('instanceId') instanceId: string,
  ) {
    return this.prisma.workflowAction.findMany({
      where: {
        instanceId,
        instance: { companyId: user.companyId },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Templates (S37 — BPM Visual Editor) ───────────────────────────────────

  @Get('templates')
  @ApiOperation({ summary: 'Listar templates de workflow' })
  @ApiQuery({ name: 'category', required: false })
  findTemplates(@Query('category') category?: string) {
    return this.workflowTemplateService.findAll(category);
  }

  @Get('templates/:id')
  @ApiOperation({ summary: 'Buscar template por ID' })
  findTemplate(@Param('id') id: string) {
    return this.workflowTemplateService.findOne(id);
  }

  @Post('templates/:id/create-workflow')
  @ApiOperation({ summary: 'Criar workflow a partir de template' })
  createFromTemplate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { name: string },
  ) {
    if (!body?.name) {
      throw new BusinessException('O campo "name" é obrigatório', 400);
    }
    return this.workflowTemplateService.createFromTemplate(user.companyId, id, body.name);
  }

  // ─── Workflow Validation & Dry-run (S37) ───────────────────────────────────

  @Post('workflows/validate')
  @ApiOperation({ summary: 'Validar definição de workflow' })
  @HttpCode(HttpStatus.OK)
  validateDefinition(@Body() body: { definition: WorkflowDefinition }) {
    return this.workflowValidator.validate(body.definition);
  }

  @Post('workflows/dry-run')
  @ApiOperation({ summary: 'Simular execução de workflow (sem persistência)' })
  @HttpCode(HttpStatus.OK)
  dryRun(@Body() body: { definition: WorkflowDefinition; variables?: Record<string, any> }) {
    return this.dryRunService.dryRun(body.definition, body.variables ?? {});
  }

  // ─── Version Diff (S37) ─────────────────────────────────────────────────────

  @Get('workflows/:id/versions/diff')
  @ApiOperation({ summary: 'Comparar duas versões de workflow' })
  @ApiQuery({ name: 'v1', required: true })
  @ApiQuery({ name: 'v2', required: true })
  async diffVersions(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('v1') v1: string,
    @Query('v2') v2: string,
  ) {
    const workflow = await this.workflowService.findOne(user.companyId, id);

    const versionA = workflow.versions.find((v: any) => v.id === v1);
    const versionB = workflow.versions.find((v: any) => v.id === v2);

    if (!versionA) {
      throw new BusinessException(`Versão "${v1}" não encontrada`, HttpStatus.NOT_FOUND);
    }
    if (!versionB) {
      throw new BusinessException(`Versão "${v2}" não encontrada`, HttpStatus.NOT_FOUND);
    }

    return this.workflowDiffService.diff(
      versionA.definition as unknown as WorkflowDefinition,
      versionB.definition as unknown as WorkflowDefinition,
    );
  }
}
