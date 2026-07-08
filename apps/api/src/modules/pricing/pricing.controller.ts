import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PricingService } from './pricing.service';

@ApiTags('pricing')
@ApiBearerAuth()
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('simulate')
  @RequirePermission('products.pricing.view')
  @ApiOperation({
    summary: 'Formação de preço — custo + impostos + margem desejada (#395)',
  })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'marginPct', required: true, type: Number, description: 'Margem desejada em %' })
  @ApiQuery({
    name: 'costOverride',
    required: false,
    type: Number,
    description: 'What-if: simula outro custo base (ex.: variação de MP)',
  })
  simulate(
    @CurrentUser() user: any,
    @Query('productId') productId: string,
    @Query('marginPct') marginPct: string,
    @Query('costOverride') costOverride?: string,
  ) {
    if (!productId) throw new BadRequestException('productId é obrigatório');
    if (marginPct == null || marginPct === '') {
      throw new BadRequestException('marginPct é obrigatório');
    }
    const margin = Number(marginPct);
    if (Number.isNaN(margin)) throw new BadRequestException('marginPct inválido');
    const override = costOverride != null && costOverride !== '' ? Number(costOverride) : undefined;
    if (override != null && Number.isNaN(override)) {
      throw new BadRequestException('costOverride inválido');
    }
    return this.pricingService.simulate(user.companyId, productId, margin, {
      costOverride: override,
    });
  }
}
