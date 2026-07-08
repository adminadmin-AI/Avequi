import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PriceService } from './price.service';
import { CreatePriceTableDto } from './dto/create-price-table.dto';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 */
@ApiTags('prices')
@ApiBearerAuth()
@Controller('prices')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  @Post()
  @RequirePermission('products.pricing.create')
  @ApiOperation({ summary: 'Criar tabela de preços (#189)' })
  create(@Body() dto: CreatePriceTableDto, @CurrentUser() user: any) {
    return this.priceService.create(dto, user.companyId);
  }

  @Get('lookup')
  @RequirePermission('products.pricing.view')
  @ApiOperation({ summary: 'Consultar preço vigente por produto/cliente/quantidade (#189)' })
  @ApiQuery({ name: 'productId', required: true })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'quantity', required: false, type: Number })
  lookup(
    @CurrentUser() user: any,
    @Query('productId') productId: string,
    @Query('customerId') customerId?: string,
    @Query('quantity') quantity?: string,
  ) {
    return this.priceService.lookup(
      user.companyId,
      productId,
      customerId,
      quantity ? parseFloat(quantity) : undefined,
    );
  }

  @Get()
  @RequirePermission('products.pricing.view')
  @ApiOperation({ summary: 'Listar tabelas de preços' })
  findAll(@CurrentUser() user: any) {
    return this.priceService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermission('products.pricing.view')
  @ApiOperation({ summary: 'Buscar tabela de preços por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.priceService.findOne(id, user.companyId);
  }
}
