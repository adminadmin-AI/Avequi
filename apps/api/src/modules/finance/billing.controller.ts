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
import { Roles } from '../../common/decorators/roles.decorator';
import { FinanceService } from './finance.service';
import { TriggerCollectionDto } from './dto/trigger-collection.dto';
import { CollectionRuleService } from './collection-rule.service';
import { UpdateCollectionRuleDto } from './dto/collection-rule.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly financeService: FinanceService,
    private readonly collectionRules: CollectionRuleService,
  ) {}

  // ─── Régua de cobrança (#384) ───────────────────────────────────────────

  @Get('collection-rules')
  @ApiOperation({ summary: 'Estágios da régua de cobrança (#384)' })
  listRules(@Request() req: { user: { companyId: string } }) {
    return this.collectionRules.findAll(req.user.companyId);
  }

  @Post('collection-rules/seed-defaults')
  @Roles('SUPER_ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Criar os 6 estágios padrão da régua (idempotente) (#384)' })
  seedDefaults(@Request() req: { user: { companyId: string } }) {
    return this.collectionRules.seedDefaults(req.user.companyId);
  }

  @Patch('collection-rules/:id')
  @Roles('SUPER_ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Ajustar um estágio da régua (#384)' })
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionRuleDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.collectionRules.update(id, req.user.companyId, dto);
  }

  @Post('collection-rules/run')
  @Roles('SUPER_ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Rodar a régua agora (o cron roda diariamente às 7h) (#384)' })
  runNow(@Request() req: { user: { companyId: string } }) {
    return this.collectionRules.run(req.user.companyId);
  }

  @Get('collection/status')
  @ApiOperation({ summary: 'Status de cobrança: recebíveis vencidos com tentativas' })
  getCollectionStatus(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getCollectionStatus(req.user.companyId);
  }

  @Get('daily-report')
  @ApiOperation({ summary: 'Relatório diário: vencidos, recebidos, pendentes, taxa de conversão' })
  getDailyReport(@Request() req: { user: { companyId: string } }) {
    return this.financeService.getDailyCollectionReport(req.user.companyId);
  }

  @Post('collection/trigger')
  @Roles('SUPER_ADMIN', 'FINANCIAL')
  @ApiOperation({ summary: 'Disparar cobrança por canal (EMAIL, WHATSAPP, PHONE)' })
  triggerCollection(
    @Body() dto: TriggerCollectionDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.triggerCollection(req.user.companyId, dto);
  }
}
