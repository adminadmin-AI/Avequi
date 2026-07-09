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
import { EquipmentStatus, MaintenanceOrderStatus, MaintenanceType } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CompleteMaintenanceOrderDto } from './dto/complete-maintenance-order.dto';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { CreateMaintenanceOrderDto } from './dto/create-maintenance-order.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { MaintenanceService } from './maintenance.service';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 * Donos das mutações: ASSISTENCIA_TECNICA/G.INDUSTRIAL; GERENTE_GERAL
 * recebeu somente leitura (decisão Rafael no PR D).
 */
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  // ─── Equipment ─────────────────────────────────────────────────────────────

  @Get('equipment')
  @RequirePermission('maintenance.equipment.view')
  listEquipment(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.maintenanceService.listEquipment(req.user.companyId, {
      status: status as EquipmentStatus | undefined,
    });
  }

  @Post('equipment')
  @RequirePermission('maintenance.equipment.create')
  createEquipment(
    @Request() req: { user: { companyId: string; id: string } },
    @Body() dto: CreateEquipmentDto,
  ) {
    return this.maintenanceService.createEquipment(
      req.user.companyId,
      dto,
      req.user.id,
    );
  }

  @Get('equipment/stats')
  @RequirePermission('maintenance.equipment.view')
  getMaintenanceStats(@Request() req: { user: { companyId: string } }) {
    return this.maintenanceService.getMaintenanceStats(req.user.companyId);
  }

  @Get('equipment/:id')
  @RequirePermission('maintenance.equipment.view')
  getEquipment(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.getEquipment(id, req.user.companyId);
  }

  @Patch('equipment/:id')
  @RequirePermission('maintenance.equipment.update')
  updateEquipment(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.maintenanceService.updateEquipment(id, req.user.companyId, dto);
  }

  @Patch('equipment/:id/deactivate')
  @RequirePermission('maintenance.equipment.deactivate')
  deactivateEquipment(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.deactivateEquipment(id, req.user.companyId);
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  @Get('orders')
  @RequirePermission('maintenance.orders.view')
  listOrders(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
    @Query('equipmentId') equipmentId?: string,
    @Query('type') type?: string,
  ) {
    return this.maintenanceService.listOrders(req.user.companyId, {
      status: status as MaintenanceOrderStatus | undefined,
      equipmentId,
      type: type as MaintenanceType | undefined,
    });
  }

  @Post('orders')
  @RequirePermission('maintenance.orders.create')
  createOrder(
    @Request() req: { user: { companyId: string; id: string } },
    @Body() dto: CreateMaintenanceOrderDto,
  ) {
    return this.maintenanceService.createOrder(
      req.user.companyId,
      dto,
      req.user.id,
    );
  }

  @Get('orders/:id')
  @RequirePermission('maintenance.orders.view')
  getOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.getOrder(id, req.user.companyId);
  }

  @Patch('orders/:id/start')
  @RequirePermission('maintenance.orders.start')
  startOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.startOrder(id, req.user.companyId);
  }

  @Patch('orders/:id/complete')
  @RequirePermission('maintenance.orders.complete')
  completeOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; id: string } },
    @Body() dto: CompleteMaintenanceOrderDto,
  ) {
    return this.maintenanceService.completeOrder(
      id,
      req.user.companyId,
      dto,
      req.user.id,
    );
  }

  @Patch('orders/:id/cancel')
  @RequirePermission('maintenance.orders.cancel')
  cancelOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.cancelOrder(id, req.user.companyId);
  }
}
