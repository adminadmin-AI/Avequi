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
import { SerialStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateSerialDto } from './dto/create-serial.dto';
import { UpdateSerialDto } from './dto/update-serial.dto';
import { SerialService } from './serial.service';

@UseGuards(JwtAuthGuard)
@Controller('serial')
export class SerialController {
  constructor(private readonly serialService: SerialService) {}

  // GET /serial?status=&productId=&warehouseId=&search=
  @Get()
  list(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: SerialStatus,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('search') search?: string,
  ) {
    return this.serialService.list(req.user.companyId, {
      status,
      productId,
      warehouseId,
      search,
    });
  }

  // POST /serial
  @Post()
  create(
    @Request() req: { user: { companyId: string; id?: string } },
    @Body() dto: CreateSerialDto,
  ) {
    return this.serialService.create(req.user.companyId, dto, req.user.id);
  }

  // GET /serial/stats
  @Get('stats')
  getStats(@Request() req: { user: { companyId: string } }) {
    return this.serialService.getStats(req.user.companyId);
  }

  // GET /serial/by-serial/:serial
  @Get('by-serial/:serial')
  getBySerial(
    @Param('serial') serial: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.serialService.getBySerial(serial, req.user.companyId);
  }

  // GET /serial/:id
  @Get(':id')
  getById(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.serialService.getById(id, req.user.companyId);
  }

  // PATCH /serial/:id
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body() dto: UpdateSerialDto,
  ) {
    return this.serialService.update(id, req.user.companyId, dto);
  }

  // PATCH /serial/:id/link-production
  @Patch(':id/link-production')
  linkToProduction(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body('productionOrderId') productionOrderId: string,
  ) {
    return this.serialService.linkToProduction(
      id,
      productionOrderId,
      req.user.companyId,
    );
  }

  // PATCH /serial/:id/link-sale
  @Patch(':id/link-sale')
  linkToSale(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body('salesOrderId') salesOrderId: string,
  ) {
    return this.serialService.linkToSale(
      id,
      salesOrderId,
      req.user.companyId,
    );
  }

  // PATCH /serial/:id/scrap
  @Patch(':id/scrap')
  scrap(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
    @Body('reason') reason?: string,
  ) {
    return this.serialService.scrap(id, req.user.companyId, reason);
  }
}
