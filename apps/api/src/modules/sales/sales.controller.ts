import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SalesService } from './sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';

@ApiTags('Sales')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Criar venda em rascunho' })
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: any) {
    return this.salesService.createOrder(dto, user?.sub);
  }

  @Get()
  @ApiOperation({ summary: 'Listar vendas da empresa' })
  @ApiQuery({ name: 'companyId', required: true })
  findAll(@Query('companyId') companyId: string) {
    return this.salesService.findAll(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar venda por ID' })
  findOne(@Param('id') id: string, @Query('companyId') companyId: string) {
    return this.salesService.findOne(id, companyId);
  }

  @Patch(':id/reserve')
  @ApiOperation({ summary: 'Reservar estoque para a venda' })
  reserve(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.salesService.reserveOrder(id, companyId, user?.sub);
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirmar venda e baixar estoque' })
  confirm(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.salesService.confirmOrder(id, companyId, user?.sub);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar venda e devolver reserva' })
  cancel(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.salesService.cancelOrder(id, companyId, user?.sub);
  }
}
