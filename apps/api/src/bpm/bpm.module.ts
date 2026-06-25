import { Module, OnModuleInit } from '@nestjs/common';
import { BpmController } from './bpm.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowEngine } from './engine/workflow-engine';
import { RuleEngine } from './engine/rule-engine';
import { ActionExecutor } from './engine/action-executor';
import { ApprovalService } from './approval.service';
import { SlaService } from './sla.service';
import { SlaTrackerService } from './sla-tracker.service';
import { TaskAssignmentService } from './task-assignment.service';
import { EventListenerService } from './event-listener.service';
import { NotificationService } from './notification.service';
import { EmailTemplateService } from './email-template.service';
import { SendEmailHandler } from './actions/send-email.handler';
import { CreateNotificationHandler } from './actions/create-notification.handler';
import { BlockCreditHandler } from './actions/block-credit.handler';
import { EscalateApprovalHandler } from './actions/escalate-approval.handler';
import { WorkflowTemplateService } from './workflow-template.service';
import { DryRunService } from './engine/dry-run.service';
import { WorkflowDiffService } from './workflow-diff.service';
import { WorkflowValidator } from './engine/workflow-validator';
import { BpmPurchaseListener } from './bpm-purchase.listener';

@Module({
  controllers: [BpmController],
  providers: [
    WorkflowService,
    WorkflowEngine,
    RuleEngine,
    ActionExecutor,
    ApprovalService,
    SlaService,
    SlaTrackerService,
    TaskAssignmentService,
    EventListenerService,
    NotificationService,
    EmailTemplateService,
    SendEmailHandler,
    CreateNotificationHandler,
    BlockCreditHandler,
    EscalateApprovalHandler,
    WorkflowTemplateService,
    DryRunService,
    WorkflowDiffService,
    WorkflowValidator,
    BpmPurchaseListener,
  ],
  exports: [
    WorkflowService,
    WorkflowEngine,
    ApprovalService,
    SlaService,
    SlaTrackerService,
    TaskAssignmentService,
    NotificationService,
    EmailTemplateService,
    RuleEngine,
    ActionExecutor,
    WorkflowTemplateService,
    DryRunService,
    WorkflowDiffService,
    WorkflowValidator,
  ],
})
export class BpmModule implements OnModuleInit {
  constructor(
    private readonly actionExecutor: ActionExecutor,
    private readonly sendEmailHandler: SendEmailHandler,
    private readonly createNotificationHandler: CreateNotificationHandler,
    private readonly blockCreditHandler: BlockCreditHandler,
    private readonly escalateApprovalHandler: EscalateApprovalHandler,
  ) {}

  onModuleInit() {
    this.actionExecutor.registerHandler(this.sendEmailHandler);
    this.actionExecutor.registerHandler(this.createNotificationHandler);
    this.actionExecutor.registerHandler(this.blockCreditHandler);
    this.actionExecutor.registerHandler(this.escalateApprovalHandler);
  }
}
