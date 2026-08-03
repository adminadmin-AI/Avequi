import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  AssignPlanDto,
  CreatePlanDto,
  SetOverrideDto,
  UpdatePlanDto,
} from './dto/plan.dtos';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsActionContext } from './ops.service';
import { PlansService } from './plans.service';

/**
 * PlansController — OPS WP4 (#911): catálogo de planos + plano/exceções por
 * tenant. Mesmas camadas do restante do /ops (permissão ops.* + OpsMfaGuard).
 * Rotas de PLANO usam ops.plans.*; as de TENANT usam ops.tenants.manage.
 */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(OpsMfaGuard)
@Controller('ops')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  private ctx(
    user: { id: string; companyId: string; sessionId?: string },
    req: Request,
  ): OpsActionContext {
    return {
      userId: user.id,
      actorCompanyId: user.companyId,
      sessionId: user.sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Get('plans')
  @RequirePermission('ops.plans.view')
  @ApiOperation({ summary: 'Operadora — catálogo de entitlements + planos cadastrados' })
  list() {
    return this.plansService.listPlans();
  }

  @Post('plans')
  @RequirePermission('ops.plans.manage')
  @ApiOperation({ summary: 'Operadora — cria plano (entitlements validados no catálogo)' })
  create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.plansService.createPlan(dto, this.ctx(user, req));
  }

  @Patch('plans/:id')
  @RequirePermission('ops.plans.manage')
  @ApiOperation({
    summary:
      'Operadora — edita plano. Afeta TODOS os tenants no plano (cache invalidado, sem redeploy).',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.plansService.updatePlan(id, dto, this.ctx(user, req));
  }

  @Get('tenants/:id/entitlements')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({ summary: 'Operadora — plano, exceções e mapa resolvido do tenant' })
  tenantEntitlements(@Param('id') id: string) {
    return this.plansService.tenantEntitlements(id);
  }

  @Patch('tenants/:id/plan')
  @RequirePermission('ops.tenants.manage')
  @ApiOperation({
    summary:
      'Operadora — troca o plano do tenant (null = volta ao legado). Auditado; efeito ≤60s.',
  })
  assignPlan(
    @Param('id') id: string,
    @Body() dto: AssignPlanDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.plansService.assignPlan(id, dto.planId ?? null, this.ctx(user, req));
  }

  @Put('tenants/:id/entitlements/:key')
  @RequirePermission('ops.tenants.manage')
  @ApiOperation({
    summary: 'Operadora — cria/atualiza exceção de entitlement (reason obrigatório, auditado)',
  })
  setOverride(
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: SetOverrideDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.plansService.setOverride(id, key, dto.value, dto.reason, this.ctx(user, req));
  }

  @Delete('tenants/:id/entitlements/:key')
  @RequirePermission('ops.tenants.manage')
  @ApiOperation({ summary: 'Operadora — remove exceção (tenant volta ao valor do plano)' })
  removeOverride(
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.plansService.removeOverride(id, key, this.ctx(user, req));
  }
}
