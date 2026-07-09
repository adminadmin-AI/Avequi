import { Controller, Get, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FinancialForecastService } from './financial-forecast.service';

@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
export class FinancialForecastController {
  constructor(private readonly service: FinancialForecastService) {}

  @Get('financial')
  // #341 parte 2 (PR E1): reusa finance.reports.view (matriz Rafael, #623)
  @RequirePermission('finance.reports.view')
  @ApiOperation({
    summary: 'Forecast financeiro trimestral rolante — receita (demanda×preço) e despesa (tendência), vs orçado e realizado (#397)',
  })
  @ApiQuery({ name: 'quarters', required: false, type: Number, description: 'Trimestres à frente (1-12, padrão 4)' })
  financial(@Request() req: { user: { companyId: string } }, @Query('quarters') quarters?: string) {
    const q = quarters != null && quarters !== '' ? Number(quarters) : 4;
    return this.service.forecast(req.user.companyId, Number.isNaN(q) ? 4 : q);
  }
}
