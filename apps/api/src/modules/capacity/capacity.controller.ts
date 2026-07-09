import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CapacityService } from './capacity.service';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';
import { QueryCapacityDto } from './dto/query-capacity.dto';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 */
@Controller('capacity')
export class CapacityController {
  constructor(private readonly capacityService: CapacityService) {}

  // ─── Work Centers ─────────────────────────────────────────────────────────

  @Get('work-centers')
  @RequirePermission('production.work-centers.view')
  listWorkCenters(
    @Request() req: { user: { companyId: string } },
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.capacityService.listWorkCenters(
      req.user.companyId,
      includeInactive === 'true',
    );
  }

  @Post('work-centers')
  @RequirePermission('production.work-centers.create')
  createWorkCenter(
    @Request() req: { user: { companyId: string } },
    @Body() dto: CreateWorkCenterDto,
  ) {
    return this.capacityService.createWorkCenter(req.user.companyId, dto);
  }

  @Get('work-centers/stats')
  @RequirePermission('production.work-centers.view')
  getWorkCenterStats(@Request() req: { user: { companyId: string } }) {
    return this.capacityService.getWorkCenterStats(req.user.companyId);
  }

  @Get('work-centers/:id')
  @RequirePermission('production.work-centers.view')
  getWorkCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.capacityService.getWorkCenter(id, req.user.companyId);
  }

  @Patch('work-centers/:id')
  @RequirePermission('production.work-centers.update')
  updateWorkCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateWorkCenterDto,
  ) {
    return this.capacityService.updateWorkCenter(id, req.user.companyId, dto);
  }

  @Delete('work-centers/:id')
  @RequirePermission('production.work-centers.delete')
  deleteWorkCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.capacityService.deleteWorkCenter(id, req.user.companyId);
  }

  // ─── Capacity Planning ────────────────────────────────────────────────────

  @Get('plan')
  @RequirePermission('production.work-centers.view')
  getCapacityPlan(
    @Request() req: { user: { companyId: string } },
    @Query() dto: QueryCapacityDto,
  ) {
    return this.capacityService.getCapacityPlan(req.user.companyId, dto);
  }

  @Get('load-by-product')
  @RequirePermission('production.work-centers.view')
  getLoadByProduct(
    @Request() req: { user: { companyId: string } },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.capacityService.getLoadByProduct(req.user.companyId, startDate, endDate);
  }
}
