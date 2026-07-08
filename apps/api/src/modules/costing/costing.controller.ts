import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CostingService } from './costing.service';

@ApiTags('costing')
@ApiBearerAuth()
@Controller('costing')
export class CostingController {
  constructor(private readonly costingService: CostingService) {}

  @Get('cif-rate')
  @RequirePermission('products.pricing.view')
  @ApiOperation({ summary: 'Taxa CIF/hora rateada dos centros de custo ativos (#396)' })
  cifRate(@CurrentUser() user: any) {
    return this.costingService.getCifRate(user.companyId);
  }

  @Get('product/:productId')
  @RequirePermission('products.pricing.view')
  @ApiOperation({
    summary: 'Custeio por absorção do produto — material + MOD + CIF, com comparativo com/sem CIF (#396)',
  })
  productCost(@Param('productId') productId: string, @CurrentUser() user: any) {
    return this.costingService.computeProductCost(user.companyId, productId);
  }
}
