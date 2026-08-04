import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateProposalDto, DecideProposalDto } from './dto/proposal.dto';
import { OPS_THROTTLE } from './ops-hardening.constants';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';
import { OpsActionContext } from './ops.service';
import { ProposalsService } from './proposals.service';

/**
 * ProposalsController — AVECCHI P2 (#963): propostas comerciais de assinatura.
 * Mesmo domínio (e gates) do billing: ops.billing.{view,manage} — nenhuma
 * permissão nova, nenhum seed. Blindagem padrão do módulo (MFA + sessão
 * curta + throttle dedicado) — o sweep de isolamento cobra.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Throttle(OPS_THROTTLE)
@UseGuards(OpsMfaGuard, OpsSessionGuard)
@Controller('ops')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  private ctx(user: { id: string; companyId: string; sessionId?: string }, req: Request): OpsActionContext {
    return {
      userId: user.id,
      actorCompanyId: user.companyId,
      sessionId: user.sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Get('tenants/:id/proposals')
  @RequirePermission('ops.billing.view')
  @ApiOperation({ summary: 'Propostas da conta (histórico comercial — aceitas = upgrades/downgrades)' })
  list(@Param('id') id: string) {
    return this.proposalsService.list(id);
  }

  @Post('tenants/:id/proposals')
  @RequirePermission('ops.billing.manage')
  @ApiOperation({ summary: 'Nova proposta: plano (preço de tabela por default) + valor negociado opcional' })
  create(
    @Param('id') id: string,
    @Body() dto: CreateProposalDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.proposalsService.create(id, dto, this.ctx(user, req));
  }

  @Post('proposals/:id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ops.billing.manage')
  @ApiOperation({ summary: 'Marca a proposta como enviada ao cliente (DRAFT → SENT)' })
  send(@Param('id') id: string, @CurrentUser() user: any, @Req() req: Request) {
    return this.proposalsService.send(id, this.ctx(user, req));
  }

  @Post('proposals/:id/accept')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ops.billing.manage')
  @ApiOperation({
    summary: 'Aceite: converte em assinatura + plano do tenant (sem digitação dupla)',
  })
  accept(
    @Param('id') id: string,
    @Body() dto: DecideProposalDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.proposalsService.accept(id, dto.decidedNote, this.ctx(user, req));
  }

  @Post('proposals/:id/decline')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ops.billing.manage')
  @ApiOperation({ summary: 'Recusa da proposta (motivo obrigatório)' })
  decline(
    @Param('id') id: string,
    @Body() dto: DecideProposalDto,
    @CurrentUser() user: any,
    @Req() req: Request,
  ) {
    return this.proposalsService.decline(id, dto.decidedNote ?? '', this.ctx(user, req));
  }
}
