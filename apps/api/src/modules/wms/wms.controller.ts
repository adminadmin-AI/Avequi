import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateLocationDto } from './dto/create-location.dto';
import { ConfirmPutawayDto } from './dto/confirm-putaway.dto';
import { WmsService } from './wms.service';

@UseGuards(JwtAuthGuard)
@Controller('wms')
export class WmsController {
  constructor(private readonly wmsService: WmsService) {}

  // POST /wms/locations
  @Post('locations')
  createLocation(@Body() dto: CreateLocationDto) {
    return this.wmsService.createLocation(dto);
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
  confirmPutaway(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: ConfirmPutawayDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.wmsService.confirmPutaway(id, taskId, req.user.companyId, dto, req.user.sub);
  }
}
