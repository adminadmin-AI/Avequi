import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Request,
  UseGuards,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SupplierTokenGuard } from './guards/supplier-token.guard';
import { SupplierPortalService } from './supplier-portal.service';
import { CreateSupplierTokenDto } from './dto/create-supplier-token.dto';
import { PurchaseOrderStatus } from '@prisma/client';

@Controller('supplier-portal')
export class SupplierPortalController {
  constructor(private readonly service: SupplierPortalService) {}

  // ── Admin endpoints (JWT protected) ──────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Post('tokens')
  createToken(
    @Request() req: { user: { companyId: string } },
    @Body() dto: CreateSupplierTokenDto,
  ) {
    return this.service.createToken(req.user.companyId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('tokens')
  listTokens(
    @Request() req: { user: { companyId: string } },
    @Query('supplierId') supplierId?: string,
  ) {
    return this.service.listTokens(req.user.companyId, supplierId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('tokens/:id/revoke')
  revokeToken(
    @Request() req: { user: { companyId: string } },
    @Param('id') id: string,
  ) {
    return this.service.revokeToken(id, req.user.companyId);
  }

  // ── Portal endpoints (Supplier Token protected) ───────────────────────────────
  @UseGuards(SupplierTokenGuard)
  @Get('me')
  getProfile(@Request() req: { supplier: { id: string } }) {
    return this.service.getProfile(req.supplier.id);
  }

  @UseGuards(SupplierTokenGuard)
  @Get('me/summary')
  getSummary(@Request() req: { supplier: { id: string } }) {
    return this.service.getPortalSummary(req.supplier.id);
  }

  @UseGuards(SupplierTokenGuard)
  @Get('me/purchase-orders')
  listPurchaseOrders(
    @Request() req: { supplier: { id: string } },
    @Query('status') status?: string,
  ) {
    return this.service.listPurchaseOrders(req.supplier.id, {
      status: status as PurchaseOrderStatus | undefined,
    });
  }

  @UseGuards(SupplierTokenGuard)
  @Get('me/purchase-orders/:id')
  getPurchaseOrder(
    @Request() req: { supplier: { id: string } },
    @Param('id') id: string,
  ) {
    return this.service.getPurchaseOrder(req.supplier.id, id);
  }

  @UseGuards(SupplierTokenGuard)
  @Get('me/receipts')
  listReceipts(@Request() req: { supplier: { id: string } }) {
    return this.service.listReceipts(req.supplier.id);
  }

  @UseGuards(SupplierTokenGuard)
  @Get('me/payments')
  listPayments(@Request() req: { supplier: { id: string } }) {
    return this.service.listPayments(req.supplier.id);
  }

  @UseGuards(SupplierTokenGuard)
  @Get('me/ncr')
  listNcrs(@Request() req: { supplier: { id: string } }) {
    return this.service.listNcrs(req.supplier.id);
  }
}
