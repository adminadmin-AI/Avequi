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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { PurchaseService } from './purchase.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('purchase')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('purchase')
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  // ─── Pedidos de Compra ────────────────────────────────────────────────────

  @Post('orders')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Criar pedido de compra em rascunho' })
  createPO(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: any) {
    return this.purchaseService.createPO(dto, user?.id);
  }

  @Patch('orders/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Editar pedido de compra em rascunho' })
  updatePO(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: any,
    @Query('companyId') companyId: string,
  ) {
    return this.purchaseService.updatePO(id, dto, companyId ?? user?.companyId, user?.id);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Listar pedidos de compra' })
  @ApiQuery({ name: 'companyId', required: true })
  findAll(@Query('companyId') companyId: string) {
    return this.purchaseService.findAll(companyId);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Buscar pedido de compra por ID' })
  @ApiQuery({ name: 'companyId', required: true })
  findOne(@Param('id') id: string, @Query('companyId') companyId: string) {
    return this.purchaseService.findOne(id, companyId);
  }

  @Post('orders/:id/approve')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Aprovar pedido de compra' })
  @ApiQuery({ name: 'companyId', required: true })
  approvePO(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.purchaseService.approvePO(id, companyId ?? user?.companyId, user?.id, user?.role);
  }

  @Post('orders/:id/cancel')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Cancelar pedido de compra' })
  @ApiQuery({ name: 'companyId', required: true })
  cancelPO(
    @Param('id') id: string,
    @Query('companyId') companyId: string,
    @CurrentUser() user: any,
  ) {
    return this.purchaseService.cancelPO(id, companyId ?? user?.companyId, user?.id);
  }

  // ─── Recebimento ─────────────────────────────────────────────────────────

  @Post('receipts')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Registrar recebimento de mercadoria (GR)' })
  createReceipt(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: any) {
    return this.purchaseService.createReceipt(dto, user?.id);
  }

  @Get('receipts')
  @ApiOperation({ summary: 'Listar recebimentos' })
  @ApiQuery({ name: 'companyId', required: true })
  @ApiQuery({ name: 'purchaseOrderId', required: false })
  findReceipts(
    @Query('companyId') companyId: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.purchaseService.findReceipts(companyId, purchaseOrderId);
  }
}
