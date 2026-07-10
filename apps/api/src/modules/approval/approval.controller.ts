import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ApprovalService } from './approval.service';

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post(':documentId/approve')
  @RequirePermission('approvals.requests.approve')
  @ApiOperation({ summary: 'Aprovar documento por alçada (#188)' })
  @ApiQuery({ name: 'documentType', required: true, enum: ['PO', 'PR', 'EXPENSE'] })
  approve(
    @Param('documentId') documentId: string,
    @Query('documentType') documentType: string,
    @CurrentUser() user: any,
  ) {
    return this.approvalService.approve(
      documentId,
      documentType,
      user.companyId,
      user.id,
      user.role,
    );
  }

  @Get('pending')
  @RequirePermission('approvals.requests.view')
  @ApiOperation({ summary: 'Listar itens pendentes de aprovação (#188)' })
  getPending(@CurrentUser() user: any) {
    return this.approvalService.getPending(user.companyId, user.role);
  }
}
