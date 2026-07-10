import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { ConfirmPutawayDto } from './dto/confirm-putaway.dto';
import { ConfirmPickTaskDto } from './dto/confirm-pick-task.dto';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import { RecordCountDto } from './dto/record-count.dto';
import { WmsService } from './wms.service';

// #341 parte 2 (bloco G): gate unico RBAC v2 (#625). SoD de inventario:
// ALMOXARIFE abre/conta (inventory.create + wms.execute); reconciliar/
// cancelar AJUSTA SALDO e fica com supervisao/gerencia (stock.inventory.
// reconcile/cancel - codes que ja existiam no catalogo).

@Controller('wms')
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  // POST /wms/locations
  @Post('locations')
  @RequirePermission('stock.wms.configure')
  createLocation(
    @Body() dto: CreateLocationDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.createLocation(dto, req.user.companyId);
  }

  // GET /wms/locations?warehouseId=...
  @Get('locations')
  @RequirePermission('stock.wms.view')
  findLocations(
    @Request() req: { user: { companyId: string } },
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.wmsService.findLocations(req.user.companyId, warehouseId);
  }

  // GET /wms/receiving?status=PENDING
  @Get('receiving')
  @RequirePermission('stock.wms.view')
  findReceivingOrders(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.wmsService.findReceivingOrders(req.user.companyId, status);
  }

  // GET /wms/receiving/:id
  @Get('receiving/:id')
  @RequirePermission('stock.wms.view')
  findReceivingOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.findReceivingOrder(id, req.user.companyId);
  }

  // GET /wms/receiving/:id/report
  @Get('receiving/:id/report')
  @RequirePermission('stock.wms.view')
  getReceivingReport(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.getReceivingReport(id, req.user.companyId);
  }

  // PATCH /wms/receiving/:id/tasks/:taskId/putaway
  @Patch('receiving/:id/tasks/:taskId/putaway')
  @RequirePermission('stock.wms.execute')
  confirmPutaway(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: ConfirmPutawayDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.confirmPutaway(id, taskId, req.user.companyId, dto, req.user.sub);
  }

  // ─── S18: Saída e Expedição ───────────────────────────────────────────────

  // GET /wms/picking?status=PENDING
  @Get('picking')
  @RequirePermission('stock.wms.view')
  findPickingOrders(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.wmsService.findPickingOrders(req.user.companyId, status);
  }

  // GET /wms/picking/:id
  @Get('picking/:id')
  @RequirePermission('stock.wms.view')
  findPickingOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.findPickingOrder(id, req.user.companyId);
  }

  // GET /wms/picking/:id/report
  @Get('picking/:id/report')
  @RequirePermission('stock.wms.view')
  getPickingReport(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.getPickingReport(id, req.user.companyId);
  }

  // PATCH /wms/picking/:id/tasks/:taskId/confirm
  @Patch('picking/:id/tasks/:taskId/confirm')
  @RequirePermission('stock.wms.execute')
  confirmPickTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: ConfirmPickTaskDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.confirmPickTask(id, taskId, req.user.companyId, dto, req.user.sub);
  }

  // ─── S19: Inventário ──────────────────────────────────────────────────────

  // POST /wms/inventory
  @Post('inventory')
  @RequirePermission('stock.inventory.create')
  createInventoryCount(
    @Body() dto: CreateInventoryCountDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.createInventoryCount(dto, req.user.companyId, req.user.sub);
  }

  // GET /wms/inventory?status=IN_PROGRESS
  @Get('inventory')
  @RequirePermission('stock.wms.view')
  findInventoryCounts(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.wmsService.findInventoryCounts(req.user.companyId, status);
  }

  // GET /wms/inventory/:id
  @Get('inventory/:id')
  @RequirePermission('stock.wms.view')
  findInventoryCount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.findInventoryCount(id, req.user.companyId);
  }

  // GET /wms/inventory/:id/report
  @Get('inventory/:id/report')
  @RequirePermission('stock.wms.view')
  getInventoryReport(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.getInventoryReport(id, req.user.companyId);
  }

  // PATCH /wms/inventory/:id/items/:itemId/count
  @Patch('inventory/:id/items/:itemId/count')
  @RequirePermission('stock.wms.execute')
  recordCount(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: RecordCountDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.recordCount(id, itemId, req.user.companyId, dto, req.user.sub);
  }

  // POST /wms/inventory/:id/reconcile
  @Post('inventory/:id/reconcile')
  @RequirePermission('stock.inventory.reconcile')
  reconcile(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.reconcile(id, req.user.companyId, req.user.sub);
  }

  // ─── S20: Polimento ───────────────────────────────────────────────────────

  // GET /wms/dashboard?warehouseId=...
  @Get('dashboard')
  @RequirePermission('stock.wms.view')
  getDashboard(
    @Request() req: { user: { companyId: string } },
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.wmsService.getDashboard(req.user.companyId, warehouseId);
  }

  // PATCH /wms/locations/:id/toggle
  @Patch('locations/:id/toggle')
  @RequirePermission('stock.wms.configure')
  toggleLocation(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.toggleLocation(id, req.user.companyId);
  }

  // PATCH /wms/warehouses/:id/wms
  @Patch('warehouses/:id/wms')
  @RequirePermission('stock.wms.configure')
  toggleWarehouseWms(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.toggleWarehouseWms(id, req.user.companyId);
  }

  // POST /wms/inventory/:id/cancel
  @Post('inventory/:id/cancel')
  @RequirePermission('stock.inventory.cancel')
  cancelInventoryCount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.cancelInventoryCount(id, req.user.companyId);
  }
}
