import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsPanelService } from './ops-panel.service';
import { OpsActionContext, OpsService } from './ops.service';
import { ProvisioningService } from './provisioning.service';

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
  constructor(
    private readonly opsService: OpsService,
    private readonly provisioningService: ProvisioningService,
    private readonly panelService: OpsPanelService,
  ) {}

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

  @Get()
  @RequirePermission('ops.tenants.view')
  @ApiOperation({
    summary:
      'Operadora — lista as contas de cliente (tenants) com resumo de uso ' +
      '(ativos 30d, NF-e do mês, erros 7d, último login — OPS WP3 #910)',
  })
  async list() {
    const [tenants, usage] = await Promise.all([
      this.opsService.listTenants(),
      this.panelService.listUsageSummary(),
    ]);
    return tenants.map((t) => ({ ...t, usage: usage[t.id] ?? null }));
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
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.opsService.updateTenantStatus(id, dto, this.ctx(user, req));
  }

  // ── OPS WP2 (#909) — provisionamento (onboarding) ──────────────────────────

  @Post()
  @RequirePermission('ops.tenants.provision')
  @ApiOperation({
    summary:
      'Operadora — inicia o onboarding de um tenant novo (Company raiz nasce TRIAL). ' +
      'Idempotente por CNPJ: provisionamento aberto é retomado, não duplicado.',
  })
  createTenant(
    @Body() dto: CreateTenantDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.provisioningService.createTenant(dto, this.ctx(user, req));
  }

  @Get(':id/provisioning')
  @RequirePermission('ops.tenants.provision')
  @ApiOperation({ summary: 'Operadora — checklist de onboarding do tenant' })
  getProvisioning(@Param('id') id: string) {
    return this.provisioningService.getProvisioning(id);
  }

  @Post(':id/provisioning/admin')
  @RequirePermission('ops.tenants.provision')
  @ApiOperation({
    summary:
      'Operadora — cria o admin do tenant e envia convite de primeiro acesso ' +
      '(reenvio revoga o token anterior; nunca senha em texto).',
  })
  inviteAdmin(
    @Param('id') id: string,
    @Body() dto: InviteAdminDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.provisioningService.inviteAdmin(id, dto, this.ctx(user, req));
  }

  @Post(':id/provisioning/fiscal-check')
  @RequirePermission('ops.tenants.provision')
  @ApiOperation({
    summary:
      'Operadora — valida a config fiscal do tenant (exige FOCUS_NFE_TOKEN__<companyId> ' +
      'escopado — fallback global pertence à matriz GDR, #695).',
  })
  fiscalCheck(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.provisioningService.runFiscalCheck(id, this.ctx(user, req));
  }

  @Post(':id/activate')
  @RequirePermission('ops.tenants.provision')
  @ApiOperation({
    summary:
      'Operadora — go-live do tenant (gate manual): exige convite aceito + fiscal ok. ' +
      'TRIAL → ACTIVE + onboardedAt, auditado síncrono.',
  })
  activate(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.provisioningService.activate(id, this.ctx(user, req));
  }

  // ── OPS WP3 (#910) — painel de contas ──────────────────────────────────────

  @Get(':id/usage')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({
    summary: 'Operadora — série diária de uso do tenant (sparklines + totais)',
  })
  usage(@Param('id') id: string, @Query('days') days?: string) {
    return this.panelService.getUsage(id, days ? Number(days) : undefined);
  }

  @Get(':id/health')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({
    summary:
      'Operadora — saúde do tenant: rejeições SEFAZ e erros 5xx recentes + pessoas/último acesso',
  })
  health(@Param('id') id: string) {
    return this.panelService.getHealth(id);
  }

  @Get(':id/timeline')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({
    summary: 'Operadora — linha do tempo do tenant (eventos ops do AuditLogV2)',
  })
  timeline(@Param('id') id: string, @Query('take') take?: string) {
    return this.panelService.getTimeline(id, take ? Number(take) : undefined);
  }
}
