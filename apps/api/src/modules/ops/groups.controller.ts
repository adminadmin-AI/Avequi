import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AddCompanyToGroupDto, CreateCompanyGroupDto } from './dto/company-group.dto';
import { GroupsService } from './groups.service';
import { OPS_THROTTLE } from './ops-hardening.constants';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';
import { OpsActionContext } from './ops.service';

/**
 * GroupsController — GRUPO ECONÔMICO (#1119), control plane da operadora.
 *
 * Mesma defesa em camadas do OpsController: cadeia global
 * (JwtAuthGuard → CompanyGuard → PermissionGuard) com
 * @RequirePermission('ops.groups.*'), que só o AVECCHI_OPERATOR tem, mais
 * OpsMfaGuard (MFA duro) e OpsSessionGuard. Toda mutação audita síncrono.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Throttle(OPS_THROTTLE)
@UseGuards(OpsMfaGuard, OpsSessionGuard)
@Controller('ops/groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

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
  @RequirePermission('ops.groups.view')
  @ApiOperation({ summary: 'Operadora — lista os grupos econômicos e suas empresas' })
  list() {
    return this.groupsService.list();
  }

  @Get(':id')
  @RequirePermission('ops.groups.view')
  @ApiOperation({ summary: 'Operadora — detalhe de um grupo econômico' })
  get(@Param('id') id: string) {
    return this.groupsService.get(id);
  }

  @Post()
  @RequirePermission('ops.groups.manage')
  @ApiOperation({ summary: 'Operadora — cria um grupo econômico' })
  create(
    @Body() dto: CreateCompanyGroupDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.groupsService.create(dto, this.ctx(user, req));
  }

  @Post(':id/companies')
  @RequirePermission('ops.groups.manage')
  @ApiOperation({
    summary:
      'Operadora — associa um tenant (empresa raiz) ao grupo. Habilita vínculo ' +
      'cruzado de usuários entre as empresas do grupo; não mistura dado nenhum.',
  })
  addCompany(
    @Param('id') id: string,
    @Body() dto: AddCompanyToGroupDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.groupsService.addCompany(id, dto, this.ctx(user, req));
  }

  @Delete(':id/companies/:memberId')
  @RequirePermission('ops.groups.manage')
  @ApiOperation({
    summary:
      'Operadora — desassocia o tenant do grupo. REVOGA os vínculos cruzados de ' +
      'perfil e as sessões de visitantes abertas sob a autorização do grupo.',
  })
  // O param se chama `memberId`, não `companyId`, DE PROPÓSITO: a sentinela
  // tenant-isolation.sweep proíbe `companyId`/`tenantId` vindo do cliente em
  // @Param/@Query — foi o vetor dos incidentes #36/#63/#218. No control plane
  // o alvo precisa vir da URL (o OpsController inteiro faz isso com `:id`);
  // o nome diferente mantém a regra afiada para o resto da API. Não renomear.
  removeCompany(
    @Param('id') id: string,
    @Param('memberId') companyId: string,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.groupsService.removeCompany(id, companyId, this.ctx(user, req));
  }
}
