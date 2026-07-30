import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { IamModule } from '../iam/iam.module';
import { ApprovalModule } from '../approval/approval.module';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

/**
 * Workspace — BFF da Home por papel (F1). Agrega dados de vários domínios
 * (alertas, financeiro, produção, qualidade, CRM, aprovações) curados pela
 * permissão efetiva do usuário (IamModule.PermissionService).
 */
@Module({
  imports: [PrismaModule, IamModule, ApprovalModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
