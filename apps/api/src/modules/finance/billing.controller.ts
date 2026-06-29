import {
  Body,
  Controller,
  Get,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FinanceService } from './finance.service';
import { TriggerCollectionDto } from './dto/trigger-collection.dto';

@ApiTags('Billing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly financeService: FinanceService) {}

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
  @ApiOperation({ summary: 'Disparar cobrança por canal (EMAIL, WHATSAPP, PHONE)' })
  triggerCollection(
    @Body() dto: TriggerCollectionDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.financeService.triggerCollection(req.user.companyId, dto);
  }
}
