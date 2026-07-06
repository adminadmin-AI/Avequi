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
import { Roles } from '../../common/decorators/roles.decorator';
import { CapacityService } from './capacity.service';
import { CreateWorkCenterDto } from './dto/create-work-center.dto';
import { UpdateWorkCenterDto } from './dto/update-work-center.dto';
import { QueryCapacityDto } from './dto/query-capacity.dto';

@Controller('capacity')
export class CapacityController {
  constructor(private readonly capacityService: CapacityService) {}

  // ─── Work Centers ─────────────────────────────────────────────────────────

  @Get('work-centers')
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
  @Roles('SUPER_ADMIN', 'MANAGER', 'PRODUCTION')
  createWorkCenter(
    @Request() req: { user: { companyId: string } },
    @Body() dto: CreateWorkCenterDto,
  ) {
    return this.capacityService.createWorkCenter(req.user.companyId, dto);
  }

  @Get('work-centers/stats')
  getWorkCenterStats(@Request() req: { user: { companyId: string } }) {
    return this.capacityService.getWorkCenterStats(req.user.companyId);
  }

  @Get('work-centers/:id')
  getWorkCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.capacityService.getWorkCenter(id, req.user.companyId);
  }

  @Patch('work-centers/:id')
  @Roles('SUPER_ADMIN', 'MANAGER', 'PRODUCTION')
  updateWorkCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateWorkCenterDto,
  ) {
    return this.capacityService.updateWorkCenter(id, req.user.companyId, dto);
  }

  @Delete('work-centers/:id')
  @Roles('SUPER_ADMIN', 'MANAGER')
  deleteWorkCenter(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.capacityService.deleteWorkCenter(id, req.user.companyId);
  }

  // ─── Capacity Planning ────────────────────────────────────────────────────

  @Get('plan')
  getCapacityPlan(
    @Request() req: { user: { companyId: string } },
    @Query() dto: QueryCapacityDto,
  ) {
    return this.capacityService.getCapacityPlan(req.user.companyId, dto);
  }

  @Get('load-by-product')
  getLoadByProduct(
    @Request() req: { user: { companyId: string } },
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.capacityService.getLoadByProduct(req.user.companyId, startDate, endDate);
  }
}
