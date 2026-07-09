import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FinanceService } from './finance.service';
import { TriggerCollectionDto } from './dto/trigger-collection.dto';
import { CollectionRuleService } from './collection-rule.service';
import { UpdateCollectionRuleDto } from './dto/collection-rule.dto';

/**
 * #341 parte 2 (PR E1): gate único RBAC v2 — @Roles legado removido (matriz
 * Rafael, issue #623). FINANCEIRO dispara a cobrança (execute); a régua em si
 * é configuração de gerência (billing.configure → G.FINANCEIRO).
 */
@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly collectionRules: CollectionRuleService,
  ) {}

  // ─── Régua de cobrança (#384) ───────────────────────────────────────────

  @Get('collection-rules')
  @RequirePermission('finance.billing.view')
  @ApiOperation({ summary: 'Estágios da régua de cobrança (#384)' })
  listRules(@Request() req: { user: { companyId: string } }) {
    return this.collectionRules.findAll(req.user.companyId);
  }

  @Post('collection-rules/seed-defaults')
  @RequirePermission('finance.billing.configure')
  @ApiOperation({ summary: 'Criar os 6 estágios padrão da régua (idempotente) (#384)' })
  seedDefaults(@Request() req: { user: { companyId: string } }) {
    return this.collectionRules.seedDefaults(req.user.companyId);
  }

  @Patch('collection-rules/:id')
  @RequirePermission('finance.billing.configure')
  @ApiOperation({ summary: 'Ajustar um estágio da régua (#384)' })
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionRuleDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.collectionRules.update(id, req.user.companyId, dto);
  }

  @Post('collection-rules/run')
  @RequirePermission('finance.billing.execute')
  @ApiOperation({ summary: 'Rodar a régua agora (o cron roda diariamente às 7h) (#384)' })
  runNow(@Request() req: { user: { companyId: string } }) {
    return this.collectionRules.run(req.user.companyId);
  }

  @Get('collection/status')
  @RequirePermission('finance.billing.view')
  @ApiOperation({ summary: 'Status de cobrança: recebíveis vencidos com tentativas' })
  getCollectionStatus(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getCollectionStatus(req.user.companyId);
  }

  @Get('daily-report')
  @RequirePermission('finance.billing.view')
  @ApiOperation({ summary: 'Relatório diário: vencidos, recebidos, pendentes, taxa de conversão' })
  getDailyReport(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getDailyCollectionReport(req.user.companyId);
  }

  @Post('collection/trigger')
  @RequirePermission('finance.billing.execute')
  @ApiOperation({ summary: 'Disparar cobrança por canal (EMAIL, WHATSAPP, PHONE)' })
  triggerCollection(
    @Body() dto: TriggerCollectionDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.triggerCollection(req.user.companyId, dto);
  }
}
