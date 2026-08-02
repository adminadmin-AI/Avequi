import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsService } from './ops.service';

/**
 * OpsController — OPS WP1 (#908): rotas do control plane da operadora.
 *
 * Defesa em camadas, nesta ordem:
 *  1. Cadeia global (JwtAuthGuard → CompanyGuard → RolesGuard → PermissionGuard):
 *     @RequirePermission('ops.tenants.*') — só AVECCHI_OPERATOR tem (o
 *     catálogo garante que nenhum perfil de tenant recebe ops.*);
 *  2. OpsMfaGuard (@UseGuards local): MFA ativo obrigatório, sem grace period;
 *  3. Toda mutação audita SÍNCRONO com ator + IP (OpsService).
 */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(OpsMfaGuard)
@Controller('ops/tenants')
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get()
  @RequirePermission('ops.tenants.view')
  @ApiOperation({ summary: 'Operadora — lista as contas de cliente (tenants)' })
  list() {
    return this.opsService.listTenants();
  }

  @Get(':id')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({ summary: 'Operadora — detalhe de um tenant (raiz + filiais)' })
  get(@Param('id') id: string) {
    return this.opsService.getTenant(id);
  }

  @Patch(':id/status')
  @RequirePermission('ops.tenants.manage')
  @ApiOperation({
    summary:
      'Operadora — muda o status do tenant (suspender/reativar/sandbox). ' +
      'SUSPENDED/CHURNED exigem motivo e revogam as sessões do tenant.',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTenantStatusDto,
    @CurrentUser() user: { id: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.opsService.updateTenantStatus(id, dto, {
      userId: user.id,
      sessionId: user.sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
