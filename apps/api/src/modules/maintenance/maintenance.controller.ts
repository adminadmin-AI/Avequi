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
import { Roles } from '../../common/decorators/roles.decorator';
import { CompleteMaintenanceOrderDto } from './dto/complete-maintenance-order.dto';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { CreateMaintenanceOrderDto } from './dto/create-maintenance-order.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { MaintenanceService } from './maintenance.service';

const MAINTENANCE_WRITE_ROLES = ['SUPER_ADMIN', 'MANAGER', 'PRODUCTION'];

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  // ─── Equipment ─────────────────────────────────────────────────────────────

  @Get('equipment')
  listEquipment(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
  ) {
    return this.maintenanceService.listEquipment(req.user.companyId, {
      status: status as EquipmentStatus | undefined,
    });
  }

  @Post('equipment')
  @Roles(...MAINTENANCE_WRITE_ROLES)
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
  getMaintenanceStats(@Request() req: { user: { companyId: string } }) {
    return this.maintenanceService.getMaintenanceStats(req.user.companyId);
  }

  @Get('equipment/:id')
  getEquipment(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.getEquipment(id, req.user.companyId);
  }

  @Patch('equipment/:id')
  @Roles(...MAINTENANCE_WRITE_ROLES)
  updateEquipment(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateEquipmentDto,
  ) {
    return this.maintenanceService.updateEquipment(id, req.user.companyId, dto);
  }

  @Patch('equipment/:id/deactivate')
  @Roles('SUPER_ADMIN', 'MANAGER')
  deactivateEquipment(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.deactivateEquipment(id, req.user.companyId);
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  @Get('orders')
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
  @Roles(...MAINTENANCE_WRITE_ROLES)
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
  getOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.getOrder(id, req.user.companyId);
  }

  @Patch('orders/:id/start')
  @Roles(...MAINTENANCE_WRITE_ROLES)
  startOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.startOrder(id, req.user.companyId);
  }

  @Patch('orders/:id/complete')
  @Roles(...MAINTENANCE_WRITE_ROLES)
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
  @Roles('SUPER_ADMIN', 'MANAGER')
  cancelOrder(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.maintenanceService.cancelOrder(id, req.user.companyId);
  }
}
