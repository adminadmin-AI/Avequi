import { Module } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { IamModule } from '../iam/iam.module';

@Module({
  // #1005: PermissionService resolve os perfis v2 de quem aprova.
  imports: [IamModule],
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
