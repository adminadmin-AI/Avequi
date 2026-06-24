import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PriceService } from './price.service';
import { CreatePriceTableDto } from './dto/create-price-table.dto';

@ApiTags('prices')
@ApiBearerAuth()
@Controller('prices')
export class PriceController {
  constructor(private readonly priceService: PriceService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL')
  @ApiOperation({ summary: 'Criar tabela de preços (#189)' })
  create(@Body() dto: CreatePriceTableDto) {
    return this.priceService.create(dto);
  }

  @Get('lookup')
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
  @ApiOperation({ summary: 'Listar tabelas de preços' })
  findAll(@CurrentUser() user: any) {
    return this.priceService.findAll(user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar tabela de preços por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.priceService.findOne(id, user.companyId);
  }
}
