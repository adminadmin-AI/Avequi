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
import { DiscountPolicyService } from './discount-policy.service';
import { UpdateDiscountPolicyDto } from './dto/discount-policy.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SetSalesPaymentsDto } from './dto/sales-payment.dto';
import { ConferOrderDto } from './dto/confer-order.dto';
import { ReturnOrderDto } from './dto/return-order.dto';

// DIRECTOR opera venda no dia a dia; STORE vende no balcão (decisões Rafael 04/07/2026)
const SALES_WRITE_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE'];

@ApiTags('Sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly discountPolicyService: DiscountPolicyService,
  ) {}

  @Post()
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Criar venda em rascunho' })
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: any) {
    return this.salesService.createOrder(dto, user.companyId, user.id, user?.role);
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

  @Get('discount-policies')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'FINANCIAL')
  @ApiOperation({ summary: 'Alçadas de desconto por papel (#391)' })
  listDiscountPolicies(@CurrentUser() user: any) {
    return this.discountPolicyService.findAll(user.companyId);
  }

  @Post('discount-policies/seed-defaults')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Criar alçadas padrão (10/20/100%) — idempotente (#391)' })
  seedDiscountPolicies(@CurrentUser() user: any) {
    return this.discountPolicyService.seedDefaults(user.companyId);
  }

  @Patch('discount-policies/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR')
  @ApiOperation({ summary: 'Ajustar alçada de desconto (#391)' })
  updateDiscountPolicy(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateDiscountPolicyDto,
  ) {
    return this.discountPolicyService.update(id, user.companyId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar venda por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.findOne(id, user.companyId);
  }

  @Patch(':id/payments')
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Definir/alterar o plano de pagamento antes do faturamento (#584)' })
  setPayments(
    @Param('id') id: string,
    @Body() dto: SetSalesPaymentsDto,
    @CurrentUser() user: any,
  ) {
    return this.salesService.setPayments(id, user.companyId, dto.payments, user?.id);
  }

  @Post(':id/authorize')
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Autorizar cartões da venda no TEF/gateway (gate do faturamento) (#596)' })
  authorizeCards(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.authorizeCards(id, user.companyId);
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
    return this.salesService.confirmOrder(id, user.companyId, user?.id, user?.role);
  }

  @Post(':id/conference')
  @Roles(...SALES_WRITE_ROLES)
  @ApiOperation({ summary: 'Conferir a carga separada (AWAITING_CONFERENCE → READY_TO_INVOICE) (#491)' })
  confer(@Param('id') id: string, @Body() dto: ConferOrderDto, @CurrentUser() user: any) {
    return this.salesService.conferOrder(id, user.companyId, dto, user?.id);
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
