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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SalesService } from './sales.service';
import { DiscountPolicyService } from './discount-policy.service';
import { UpdateDiscountPolicyDto } from './dto/discount-policy.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SetSalesPaymentsDto } from './dto/sales-payment.dto';
import { ConferOrderDto } from './dto/confer-order.dto';
import { ReturnOrderDto } from './dto/return-order.dto';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #621).
 *
 * Decisões de produto refletidas aqui:
 *  - DIRETOR não opera venda no dia a dia (filosofia v2 confirmada no PR C);
 *  - faturar segue fora do vendedor e do LOJA_OPERACIONAL (split #463);
 *  - devolução/cancelamento seguem sensíveis (G.GERAL fora, decisão #463);
 *  - alçadas de desconto: configurar é gestão comercial, não diretoria.
 */
@ApiTags('Sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly discountPolicyService: DiscountPolicyService,
  ) {}

  @Post()
  @RequirePermission('sales.orders.create')
  @ApiOperation({ summary: 'Criar venda em rascunho' })
  create(@Body() dto: CreateSalesOrderDto, @CurrentUser() user: any) {
    return this.salesService.createOrder(dto, user.companyId, user.id, user?.role);
  }

  @Get()
  @RequirePermission('sales.orders.view')
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
  @RequirePermission('sales.discount-policies.view')
  @ApiOperation({ summary: 'Alçadas de desconto por papel (#391)' })
  listDiscountPolicies(@CurrentUser() user: any) {
    return this.discountPolicyService.findAll(user.companyId);
  }

  @Post('discount-policies/seed-defaults')
  @RequirePermission('sales.discount-policies.configure')
  @ApiOperation({ summary: 'Criar alçadas padrão (10/20/100%) — idempotente (#391)' })
  seedDiscountPolicies(@CurrentUser() user: any) {
    return this.discountPolicyService.seedDefaults(user.companyId);
  }

  @Patch('discount-policies/:id')
  @RequirePermission('sales.discount-policies.configure')
  @ApiOperation({ summary: 'Ajustar alçada de desconto (#391)' })
  updateDiscountPolicy(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateDiscountPolicyDto,
  ) {
    return this.discountPolicyService.update(id, user.companyId, dto);
  }

  @Get(':id')
  @RequirePermission('sales.orders.view')
  @ApiOperation({ summary: 'Buscar venda por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.findOne(id, user.companyId);
  }

  @Patch(':id/payments')
  @RequirePermission('sales.orders.set-payments')
  @ApiOperation({ summary: 'Definir/alterar o plano de pagamento antes do faturamento (#584)' })
  setPayments(
    @Param('id') id: string,
    @Body() dto: SetSalesPaymentsDto,
    @CurrentUser() user: any,
  ) {
    return this.salesService.setPayments(id, user.companyId, dto.payments, user?.id);
  }

  @Post(':id/authorize')
  @RequirePermission('sales.orders.authorize-cards')
  @ApiOperation({ summary: 'Autorizar cartões da venda no TEF/gateway (gate do faturamento) (#596)' })
  authorizeCards(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.authorizeCards(id, user.companyId);
  }

  @Patch(':id/reserve')
  @RequirePermission('sales.orders.reserve')
  @ApiOperation({ summary: 'Reservar estoque para a venda (DRAFT → RESERVED)' })
  reserve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.reserveOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/confirm')
  @RequirePermission('sales.orders.confirm')
  @ApiOperation({ summary: 'Confirmar venda e iniciar picking (RESERVED → AWAITING_PICKING)' })
  confirm(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.confirmOrder(id, user.companyId, user?.id, user?.role);
  }

  @Post(':id/conference')
  @RequirePermission('sales.orders.confer')
  @ApiOperation({ summary: 'Conferir a carga separada (AWAITING_CONFERENCE → READY_TO_INVOICE) (#491)' })
  confer(@Param('id') id: string, @Body() dto: ConferOrderDto, @CurrentUser() user: any) {
    return this.salesService.conferOrder(id, user.companyId, dto, user?.id);
  }

  @Patch(':id/invoice')
  @RequirePermission('sales.orders.invoice')
  @ApiOperation({ summary: 'Faturar venda: baixa estoque e gera NF-e (READY_TO_INVOICE → INVOICED)' })
  invoice(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.invoiceOrder(id, user.companyId, user?.id);
  }

  @Patch(':id/return')
  @RequirePermission('sales.orders.return')
  @ApiOperation({ summary: 'Devolver venda faturada: estorna estoque (INVOICED → RETURNED)' })
  return(
    @Param('id') id: string,
    @Body() dto: ReturnOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.salesService.returnOrder(id, user.companyId, dto, user?.id);
  }

  @Patch(':id/cancel')
  @RequirePermission('sales.orders.cancel')
  @ApiOperation({ summary: 'Cancelar venda (até CONFIRMED). Faturadas usam /return.' })
  cancel(@Param('id') id: string, @CurrentUser() user: any) {
    return this.salesService.cancelOrder(id, user.companyId, user?.id);
  }
}
