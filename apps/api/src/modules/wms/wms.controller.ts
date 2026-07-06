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
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateLocationDto } from './dto/create-location.dto';
import { ConfirmPutawayDto } from './dto/confirm-putaway.dto';
import { ConfirmPickTaskDto } from './dto/confirm-pick-task.dto';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import { RecordCountDto } from './dto/record-count.dto';
import { WmsService } from './wms.service';

const WMS_WRITE_ROLES = ['SUPER_ADMIN', 'MANAGER', 'WAREHOUSE'];

@Controller('wms')
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  // POST /wms/locations
  @Post('locations')
  @Roles(...WMS_WRITE_ROLES)
  createLocation(
    @Body() dto: CreateLocationDto,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.createLocation(dto, req.user.companyId);
  }

  // GET /wms/locations?warehouseId=...
  @Get('locations')
  findLocations(
    @Request() req: { user: { companyId: string } },
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.wmsService.findLocations(req.user.companyId, warehouseId);
  }

  // GET /wms/receiving?status=PENDING
  @Get('receiving')
  findReceivingOrders(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.wmsService.findReceivingOrders(req.user.companyId, status);
  }

  // GET /wms/receiving/:id
  @Get('receiving/:id')
  findReceivingOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.findReceivingOrder(id, req.user.companyId);
  }

  // GET /wms/receiving/:id/report
  @Get('receiving/:id/report')
  getReceivingReport(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.getReceivingReport(id, req.user.companyId);
  }

  // PATCH /wms/receiving/:id/tasks/:taskId/putaway
  @Patch('receiving/:id/tasks/:taskId/putaway')
  @Roles(...WMS_WRITE_ROLES)
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
  findPickingOrders(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.wmsService.findPickingOrders(req.user.companyId, status);
  }

  // GET /wms/picking/:id
  @Get('picking/:id')
  findPickingOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.findPickingOrder(id, req.user.companyId);
  }

  // GET /wms/picking/:id/report
  @Get('picking/:id/report')
  getPickingReport(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.getPickingReport(id, req.user.companyId);
  }

  // PATCH /wms/picking/:id/tasks/:taskId/confirm
  @Patch('picking/:id/tasks/:taskId/confirm')
  @Roles(...WMS_WRITE_ROLES)
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
  @Roles(...WMS_WRITE_ROLES)
  createInventoryCount(
    @Body() dto: CreateInventoryCountDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.createInventoryCount(dto, req.user.companyId, req.user.sub);
  }

  // GET /wms/inventory?status=IN_PROGRESS
  @Get('inventory')
  findInventoryCounts(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.wmsService.findInventoryCounts(req.user.companyId, status);
  }

  // GET /wms/inventory/:id
  @Get('inventory/:id')
  findInventoryCount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.findInventoryCount(id, req.user.companyId);
  }

  // GET /wms/inventory/:id/report
  @Get('inventory/:id/report')
  getInventoryReport(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.getInventoryReport(id, req.user.companyId);
  }

  // PATCH /wms/inventory/:id/items/:itemId/count
  @Patch('inventory/:id/items/:itemId/count')
  @Roles(...WMS_WRITE_ROLES)
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
  @Roles('SUPER_ADMIN', 'MANAGER')
  reconcile(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.reconcile(id, req.user.companyId, req.user.sub);
  }

  // ─── S20: Polimento ───────────────────────────────────────────────────────

  // GET /wms/dashboard?warehouseId=...
  @Get('dashboard')
  getDashboard(
    @Request() req: { user: { companyId: string } },
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.wmsService.getDashboard(req.user.companyId, warehouseId);
  }

  // PATCH /wms/locations/:id/toggle
  @Patch('locations/:id/toggle')
  @Roles('SUPER_ADMIN', 'MANAGER')
  toggleLocation(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.toggleLocation(id, req.user.companyId);
  }

  // PATCH /wms/warehouses/:id/wms
  @Patch('warehouses/:id/wms')
  @Roles('SUPER_ADMIN', 'MANAGER')
  toggleWarehouseWms(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.toggleWarehouseWms(id, req.user.companyId);
  }

  // POST /wms/inventory/:id/cancel
  @Post('inventory/:id/cancel')
  @Roles('SUPER_ADMIN', 'MANAGER')
  cancelInventoryCount(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.wmsService.cancelInventoryCount(id, req.user.companyId);
  }
}
