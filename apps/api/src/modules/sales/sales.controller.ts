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
import { Roles } from '../../common/decorators/roles.decorator';
import { SalesService } from './sales.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { ReturnOrderDto } from './dto/return-order.dto';

// DIRECTOR opera venda no dia a dia; STORE vende no balcão (decisões Rafael 04/07/2026)
const SALES_WRITE_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE'];

@ApiTags('Sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Criar venda em rascunho' })
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: any) {
    return this.salesService.createOrder(dto, user.companyId, user.id);
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

  @Patch(':id/reserve')
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Reservar estoque para a venda (DRAFT → RESERVED)' })
  reserve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.reserveOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/confirm')
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Confirmar venda e iniciar picking (RESERVED → AWAITING_PICKING)' })
  confirm(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.confirmOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/invoice')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL', 'STORE')
  @ApiOperation({ summary: 'Faturar venda: baixa estoque e gera NF-e (READY_TO_INVOICE → INVOICED)' })
  invoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.invoiceOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/return')
  @Roles('SUPER_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Devolver venda faturada: estorna estoque (INVOICED → RETURNED)' })
  return(
    @Param('id') id: string,
    @Body() dto: ReturnOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.salesService.returnOrder(id, user.companyId, dto, user?.id);
  }

  @Patch(':id/cancel')
  @Roles('SUPER_ADMIN', 'MANAGER')
  @ApiOperation({ summary: 'Cancelar venda (até CONFIRMED). Faturadas usam /return.' })
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.cancelOrder(id, user.companyId, user?.id);
  }
}
