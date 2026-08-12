import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ApprovalService } from './approval.service';
import { CreateApprovalMatrixDto, UpdateApprovalMatrixDto } from './dto/approval-matrix.dto';

@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  // ── Matriz de alçadas (#1005) — rotas estáticas antes da rota com :param ──

  @Get('matrix')
  @RequirePermission('approvals.matrix.view')
  @ApiOperation({ summary: 'Listar a matriz de alçadas de aprovação (#1005)' })
  listMatrix(@CurrentUser() user: any) {
    return this.approvalService.listMatrix(user.companyId);
  }

  @Get('matrix/role-options')
  @RequirePermission('approvals.matrix.view')
  @ApiOperation({ summary: 'Perfis v2 ativos oferecíveis como aprovadores (#1005)' })
  roleOptions(@CurrentUser() user: any) {
    return this.approvalService.roleOptions(user.companyId);
  }

  @Post('matrix')
  @RequirePermission('approvals.matrix.configure')
  @ApiOperation({ summary: 'Criar nível na matriz de alçadas (#1005)' })
  createMatrix(@Body() dto: CreateApprovalMatrixDto, @CurrentUser() user: any) {
    return this.approvalService.createMatrix(user.companyId, dto);
  }

  @Patch('matrix/:id')
  @RequirePermission('approvals.matrix.configure')
  @ApiOperation({ summary: 'Editar nível da matriz de alçadas (#1005)' })
  updateMatrix(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalMatrixDto,
    @CurrentUser() user: any,
  ) {
    return this.approvalService.updateMatrix(id, user.companyId, dto);
  }

  @Delete('matrix/:id')
  @RequirePermission('approvals.matrix.configure')
  @ApiOperation({ summary: 'Excluir nível da matriz de alçadas (#1005)' })
  deleteMatrix(@Param('id') id: string, @CurrentUser() user: any) {
    return this.approvalService.deleteMatrix(id, user.companyId);
  }

  // ── Aprovação e fila ──────────────────────────────────────────────────────

  @Post(':documentId/approve')
  @RequirePermission('approvals.requests.approve')
  @ApiOperation({ summary: 'Aprovar documento por alçada (#188)' })
  @ApiQuery({ name: 'documentType', required: true, enum: ['PO', 'PR', 'EXPENSE'] })
  approve(
    @Param('documentId') documentId: string,
    @Query('documentType') documentType: string,
    @CurrentUser() user: any,
  ) {
    // #1005: o enum user.role saiu daqui — os perfis v2 são resolvidos no service.
    return this.approvalService.approve(documentId, documentType, user.companyId, user.id);
  }

  @Get('pending')
  @RequirePermission('approvals.requests.view')
  @ApiOperation({ summary: 'Listar itens pendentes de aprovação (#188)' })
  getPending(@CurrentUser() user: any) {
    return this.approvalService.getPending(user.companyId, user.id);
  }
}
