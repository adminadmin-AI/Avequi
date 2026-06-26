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
import { PurchaseRequestStatus } from '@prisma/client';
import { PurchaseService } from './purchase.service';
import { ThreeWayMatchService } from './three-way-match.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';
import { CreatePurchaseRequestDto } from './dto/create-purchase-request.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseController {
  constructor(
    private readonly purchaseService: PurchaseService,
    private readonly matchService: ThreeWayMatchService,
  ) {}

  // ─── Pedidos de Compra ────────────────────────────────────────────────────

  @Post('orders')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Criar pedido de compra em rascunho' })
  createPO(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: any) {
    return this.purchaseService.createPO({ ...dto, companyId: user.companyId }, user.id);
  }

  @Patch('orders/:id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Editar pedido de compra em rascunho' })
  updatePO(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.purchaseService.updatePO(id, dto, user.companyId, user?.id);
  }

  @Get('orders')
  @ApiOperation({ summary: 'Listar pedidos de compra' })
  findAll(@CurrentUser() user: any) {
    return this.purchaseService.findAll(user.companyId);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Buscar pedido de compra por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.purchaseService.findOne(id, user.companyId);
  }

  @Post('orders/:id/approve')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Aprovar pedido de compra' })
  approvePO(@Param('id') id: string, @CurrentUser() user: any) {
    return this.purchaseService.approvePO(id, user.companyId, user?.id, user?.role);
  }

  @Post('orders/:id/cancel')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Cancelar pedido de compra' })
  cancelPO(@Param('id') id: string, @CurrentUser() user: any) {
    return this.purchaseService.cancelPO(id, user.companyId, user?.id);
  }

  // ─── Recebimento ─────────────────────────────────────────────────────────

  @Post('receipts')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE')
  @ApiOperation({ summary: 'Registrar recebimento de mercadoria (GR)' })
  createReceipt(@Body() dto: CreateGoodsReceiptDto, @CurrentUser() user: any) {
    return this.purchaseService.createReceipt(dto, user.id, user.companyId);
  }

  @Get('receipts')
  @ApiOperation({ summary: 'Listar recebimentos' })
  @ApiQuery({ name: 'purchaseOrderId', required: false })
  findReceipts(
    @CurrentUser() user: any,
    @Query('purchaseOrderId') purchaseOrderId?: string,
  ) {
    return this.purchaseService.findReceipts(user.companyId, purchaseOrderId);
  }

  @Get('orders/:id/receiving-status')
  @ApiOperation({ summary: 'Status de recebimento parcial da PO (#190)' })
  getReceivingStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.purchaseService.getReceivingStatus(id, user.companyId);
  }

  // ─── 3-Way Match ─────────────────────────────────────────────────────────

  @Get('orders/:id/match-status')
  @ApiOperation({ summary: '3-Way Match: status PO × GR × NF-e' })
  matchStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.matchService.getMatchStatus(id, user.companyId);
  }

  @Post('orders/:id/match')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL')
  @ApiOperation({ summary: '3-Way Match: salvar resultado do match' })
  saveMatch(@Param('id') id: string, @CurrentUser() user: any) {
    return this.matchService.saveMatch(id, user.companyId);
  }

  @Post('matches/:id/resolve')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: '3-Way Match: aprovar exceção de divergência' })
  resolveMatch(@Param('id') id: string, @CurrentUser() user: any) {
    return this.matchService.resolveMatch(id, user.companyId, user?.id);
  }

  // ─── Solicitações de Compra (S05.07) ─────────────────────────────────────

  @Post('requests')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'WAREHOUSE', 'STORE')
  @ApiOperation({ summary: 'Criar solicitação de compra' })
  createRequest(@Body() dto: CreatePurchaseRequestDto, @CurrentUser() user: any) {
    return this.purchaseService.createRequest({ ...dto, companyId: user.companyId }, user.id);
  }

  @Get('requests')
  @ApiOperation({ summary: 'Listar solicitações de compra' })
  @ApiQuery({ name: 'status', required: false, enum: PurchaseRequestStatus })
  findRequests(
    @CurrentUser() user: any,
    @Query('status') status?: PurchaseRequestStatus,
  ) {
    return this.purchaseService.findRequests(user.companyId, status);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({ summary: 'Cancelar solicitação de compra' })
  cancelRequest(@Param('id') id: string, @CurrentUser() user: any) {
    return this.purchaseService.cancelRequest(id, user.companyId);
  }

  @Post('requests/:id/convert')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Converter solicitação em pedido de compra' })
  convertRequest(
    @Param('id') id: string,
    @Body() body: { supplierId: string; unitCost: number },
    @CurrentUser() user: any,
  ) {
    return this.purchaseService.convertRequestToPO(id, user.companyId, body.supplierId, body.unitCost, user?.id);
  }

  // ─── Histórico de Preços (S06.05) ─────────────────────────────────────────

  @Get('supplier-prices')
  @ApiOperation({ summary: 'Histórico de preços por fornecedor/produto' })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiQuery({ name: 'productId', required: false })
  findSupplierPrices(
    @CurrentUser() user: any,
    @Query('supplierId') supplierId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.purchaseService.findSupplierPriceHistory(user.companyId, supplierId, productId);
  }
}
