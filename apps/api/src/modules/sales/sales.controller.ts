import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SalesOrderStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SalesService } from './sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ReturnOrderDto } from './dto/return-order.dto';

@ApiTags('Sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @ApiOperation({ summary: 'Criar venda em rascunho' })
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: any) {
    return this.salesService.createOrder(dto, user?.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar vendas da empresa' })
  @ApiQuery({ name: 'status', required: false, enum: SalesOrderStatus })
  @ApiQuery({ name: 'customerId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'Data início (ISO)' })
  @ApiQuery({ name: 'to', required: false, description: 'Data fim (ISO)' })
  findAll(
    @CurrentUser() user: any,
    @Query('status') status?: SalesOrderStatus,
    @Query('customerId') customerId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.salesService.findAll(user.companyId, { status, customerId, from, to });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar venda por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.findOne(id, user.companyId);
  }

  @Patch(':id/approve-credit')
  @ApiOperation({ summary: 'Aprovar crédito e liberar OV (CREDIT_HOLD → DRAFT) (#187)' })
  approveCredit(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.approveCreditHold(id, user.companyId, user?.id);
  }

  @Patch(':id/reserve')
  @ApiOperation({ summary: 'Reservar estoque para a venda (DRAFT → RESERVED)' })
  reserve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.reserveOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: 'Confirmar venda e iniciar picking (RESERVED → AWAITING_PICKING)' })
  confirm(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.confirmOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/invoice')
  @ApiOperation({ summary: 'Faturar venda: baixa estoque e gera NF-e (READY_TO_INVOICE → INVOICED)' })
  invoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.invoiceOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/return')
  @ApiOperation({ summary: 'Devolver venda faturada: estorna estoque (INVOICED → RETURNED)' })
  return(
    @Param('id') id: string,
    @Body() dto: ReturnOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.salesService.returnOrder(id, user.companyId, dto, user?.id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar venda (até CONFIRMED). Faturadas usam /return.' })
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.cancelOrder(id, user.companyId, user?.id);
  }
}
