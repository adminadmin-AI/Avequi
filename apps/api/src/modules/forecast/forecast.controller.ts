import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ForecastService } from './forecast.service';
import { GenerateForecastDto } from './dto/generate-forecast.dto';
import { AdjustForecastDto } from './dto/adjust-forecast.dto';

@Controller('forecast')
export class ForecastController {
  constructor(private readonly forecastService: ForecastService) {}

  // POST /forecast/generate
  // Body: { targetPeriod?, windowMonths?, productId? } — companyId vem do JWT
  @Post('generate')
  @Roles('SUPER_ADMIN', 'MANAGER', 'COMMERCIAL')
  generate(
    @Body() dto: GenerateForecastDto,
    @Request() req: { user: { companyId: string; id: string } },
  ) {
    return this.forecastService.generateForecasts(dto, req.user.companyId, req.user.id);
  }

  // GET /forecast/backtest?companyId=&testMonths=3&windowMonths=3&productId=
  @Get('backtest')
  backtest(
    @Request() req: { user: { companyId: string } },
    @Query('testMonths') testMonths?: string,
    @Query('windowMonths') windowMonths?: string,
    @Query('productId') productId?: string,
  ) {
    return this.forecastService.runBacktest(req.user.companyId, {
      testMonths: testMonths ? parseInt(testMonths, 10) : undefined,
      windowMonths: windowMonths ? parseInt(windowMonths, 10) : undefined,
      productId,
    });
  }

  // GET /forecast/history/:productId?months=24
  @Get('history/:productId')
  history(
    @Param('productId') productId: string,
    @Request() req: { user: { companyId: string } },
    @Query('months') months?: string,
  ) {
    return this.forecastService.getSalesHistory(
      req.user.companyId,
      productId,
      months ? parseInt(months, 10) : undefined,
    );
  }

  // GET /forecast?period=YYYY-MM
  @Get()
  list(
    @Request() req: { user: { companyId: string } },
    @Query('period') period?: string,
  ) {
    const targetPeriod =
      period ??
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })();
    return this.forecastService.listForecasts(req.user.companyId, targetPeriod);
  }

  // PATCH /forecast/:id/adjust
  @Patch(':id/adjust')
  @Roles('SUPER_ADMIN', 'MANAGER', 'COMMERCIAL')
  adjust(
    @Param('id') id: string,
    @Body() dto: AdjustForecastDto,
    @Request() req: { user: { companyId: string; id: string } },
  ) {
    return this.forecastService.adjustForecast(id, req.user.companyId, dto, req.user.id);
  }
}
