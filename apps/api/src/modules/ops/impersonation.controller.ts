import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ImpersonationService } from './impersonation.service';
import { Throttle } from '@nestjs/throttler';
import { OPS_THROTTLE } from './ops-hardening.constants';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';
import { OpsActionContext } from './ops.service';

export class StartImpersonationDto {
  @ApiProperty({ description: 'Usuário do tenant a visualizar' })
  @IsString()
  userId: string;

  @ApiProperty({ description: 'Motivo — vai pra auditoria e pro log do cliente', minLength: 5 })
  @IsString()
  @MinLength(5)
  @MaxLength(300)
  reason: string;
}

/**
 * ImpersonationController — OPS WP6 (#913). Camadas padrão do /ops
 * (ops.impersonation.execute + OpsMfaGuard). F1 é READ-ONLY sempre.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Throttle(OPS_THROTTLE)
@UseGuards(OpsMfaGuard, OpsSessionGuard)
@Controller('ops')
export class ImpersonationController {
  constructor(private readonly impersonationService: ImpersonationService) {}

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

  @Post('tenants/:id/impersonate')
  @RequirePermission('ops.impersonation.execute')
  @ApiOperation({
    summary:
      'Operadora — inicia visita READ-ONLY como um usuário do tenant (token dedicado 30min, ' +
      'motivo obrigatório, auditado e visível ao cliente)',
  })
  start(
    @Param('id') id: string,
    @Body() dto: StartImpersonationDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.impersonationService.start(id, dto.userId, dto.reason, this.ctx(user, req));
  }

  @Post('tenants/:id/impersonation/:iid/end')
  @RequirePermission('ops.impersonation.execute')
  @ApiOperation({ summary: 'Operadora — encerra a visita antes da expiração (denylist do iid)' })
  end(
    @Param('id') id: string,
    @Param('iid') iid: string,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.impersonationService.end(id, iid, this.ctx(user, req));
  }
}

/**
 * SupportAccessController — transparência do lado do CLIENTE: o admin do
 * tenant vê quem do suporte acessou a conta, quando e por quê. Gate:
 * iam.audit-logs.view (mesma decisão de acesso da trilha de auditoria).
 */
@ApiTags('support-access')
@ApiBearerAuth()
@Controller('support-access')
export class SupportAccessController {
  constructor(private readonly impersonationService: ImpersonationService) {}

  @Get()
  @RequirePermission('iam.audit-logs.view')
  @ApiOperation({ summary: 'Acessos do suporte Avecchi à MINHA conta (transparência)' })
  list(@CurrentUser() user: { companyId: string }) {
    return this.impersonationService.listSupportAccess(user.companyId);
  }
}
