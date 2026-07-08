import { Controller, Get, Query, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { FinancialForecastService } from './financial-forecast.service';

@ApiTags('forecast')
@ApiBearerAuth()
@Controller('forecast')
export class FinancialForecastController {
  constructor(private readonly service: FinancialForecastService) {}

  @Get('financial')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL')
  @ApiOperation({
    summary: 'Forecast financeiro trimestral rolante — receita (demanda×preço) e despesa (tendência), vs orçado e realizado (#397)',
  })
  @ApiQuery({ name: 'quarters', required: false, type: Number, description: 'Trimestres à frente (1-12, padrão 4)' })
  financial(@Request() req: { user: { companyId: string } }, @Query('quarters') quarters?: string) {
    const q = quarters != null && quarters !== '' ? Number(quarters) : 4;
    return this.service.forecast(req.user.companyId, Number.isNaN(q) ? 4 : q);
  }
}
