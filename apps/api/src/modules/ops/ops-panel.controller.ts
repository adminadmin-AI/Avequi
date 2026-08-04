import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Throttle } from '@nestjs/throttler';
import { OPS_THROTTLE } from './ops-hardening.constants';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';
import { OpsPanelService } from './ops-panel.service';
import {
  METERING_BACKFILL_DAYS,
  UsageMeteringService,
  utcDayStart,
} from './usage-metering.service';

/** POST /ops/metering/run — reprocessa os últimos N dias (default: só ontem). */
export class RunMeteringDto {
  @ApiPropertyOptional({
    description: `Dias a reprocessar (1 = só ontem). Máx ${METERING_BACKFILL_DAYS}.`,
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(METERING_BACKFILL_DAYS)
  days?: number;
}

/**
 * OpsPanelController — OPS WP3 (#910): rotas da operadora fora do escopo de
 * um tenant específico (alertas da carteira + operação do metering).
 * Mesmas camadas do OpsController: permissão ops.* + OpsMfaGuard.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Throttle(OPS_THROTTLE)
@UseGuards(OpsMfaGuard, OpsSessionGuard)
@Controller('ops')
export class OpsPanelController {
  constructor(
    private readonly panelService: OpsPanelService,
    private readonly meteringService: UsageMeteringService,
  ) {}

  @Get('panel/kpis')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({
    summary:
      'Painel da Operadora (#957) — KPIs de carteira (contas por status, novas no mês); ' +
      'a metade financeira vem de GET /ops/billing (ops.billing.view)',
  })
  portfolioKpis() {
    return this.panelService.getPortfolioKpis();
  }

  @Get('alerts')
  @RequirePermission('ops.tenants.view')
  @ApiOperation({
    summary:
      'Operadora — alertas da carteira: sem login 7d, pico de 5xx, rejeição SEFAZ, ' +
      'trial vencendo (SANDBOX/CHURNED fora)',
  })
  alerts() {
    return this.panelService.getAlerts();
  }

  @Post('metering/run')
  @RequirePermission('ops.tenants.manage')
  @ApiOperation({
    summary:
      'Operadora — reprocessa o metering diário (upsert idempotente; usar após ' +
      'incidente do cron ou no primeiro deploy p/ backfill)',
  })
  async runMetering(@Body() dto: RunMeteringDto) {
    const days = dto.days ?? 1;
    if (days === 1) {
      const yesterday = utcDayStart(new Date(Date.now() - 24 * 3600 * 1000));
      await this.meteringService.aggregateDay(yesterday);
      return { processedDays: 1 };
    }
    const processed = await this.meteringService.backfill(days);
    return { processedDays: processed };
  }
}
