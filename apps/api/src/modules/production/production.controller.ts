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
import { ProductionOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { ProductionService } from './production.service';

@UseGuards(JwtAuthGuard)
@Controller('production')
export class ProductionController {
  constructor(private readonly productionService: ProductionService) {}

  // POST /production
  @Post()
  create(
    @Body() dto: CreateProductionOrderDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.productionService.create(dto, req.user.sub);
  }

  // GET /production?status=DRAFT
  @Get()
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: ProductionOrderStatus,
  ) {
    return this.productionService.findAll(req.user.companyId, status);
  }

  // GET /production/:id
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.findOne(id, req.user.companyId);
  }

  // PATCH /production/:id/release
  @Patch(':id/release')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.release(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/start
  @Patch(':id/start')
  start(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.start(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/complete
  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('producedQty') producedQty?: number,
  ) {
    return this.productionService.complete(id, req.user.companyId, producedQty, req.user.sub);
  }

  // PATCH /production/:id/cancel
  @Patch(':id/cancel')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.cancel(id, req.user.companyId, req.user.sub);
  }
}
