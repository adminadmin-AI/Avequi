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
import { BatchStatus } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BatchService } from './batch.service';
import { AdjustBatchDto } from './dto/adjust-batch.dto';
import { ConsumeBatchDto } from './dto/consume-batch.dto';
import { CreateBatchDto } from './dto/create-batch.dto';

@UseGuards(JwtAuthGuard)
@Controller('batch')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  // GET /batch
  @Get()
  list(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: string,
    @Query('productId') productId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('expiringBeforeDays') expiringBeforeDays?: string,
  ) {
    return this.batchService.list(req.user.companyId, {
      status: status as BatchStatus | undefined,
      productId,
      supplierId,
      expiringBeforeDays: expiringBeforeDays
        ? Number(expiringBeforeDays)
        : undefined,
    });
  }

  // POST /batch
  @Post()
  create(
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: CreateBatchDto,
  ) {
    return this.batchService.create(req.user.companyId, dto, req.user.userId);
  }

  // GET /batch/stats
  @Get('stats')
  getStats(@Request() req: { user: { companyId: string } }) {
    return this.batchService.getStats(req.user.companyId);
  }

  // POST /batch/check-expired
  @Post('check-expired')
  checkExpired(@Request() req: { user: { companyId: string } }) {
    return this.batchService.checkExpired(req.user.companyId);
  }

  // GET /batch/:id
  @Get(':id')
  getById(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.batchService.getById(id, req.user.companyId);
  }

  // GET /batch/:id/traceability
  @Get(':id/traceability')
  getTraceability(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.batchService.getTraceability(id, req.user.companyId);
  }

  // PATCH /batch/:id/consume
  @Patch(':id/consume')
  consume(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: ConsumeBatchDto,
  ) {
    return this.batchService.consume(id, req.user.companyId, dto, req.user.userId);
  }

  // PATCH /batch/:id/quarantine
  @Patch(':id/quarantine')
  quarantine(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() body: { reason: string },
  ) {
    return this.batchService.quarantine(id, req.user.companyId, body.reason, req.user.userId);
  }

  // PATCH /batch/:id/release
  @Patch(':id/release')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
  ) {
    return this.batchService.release(id, req.user.companyId, req.user.userId);
  }

  // PATCH /batch/:id/scrap
  @Patch(':id/scrap')
  scrap(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() body: { reason: string },
  ) {
    return this.batchService.scrap(id, req.user.companyId, body.reason, req.user.userId);
  }

  // PATCH /batch/:id/adjust
  @Patch(':id/adjust')
  adjust(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: AdjustBatchDto,
  ) {
    return this.batchService.adjust(id, req.user.companyId, dto, req.user.userId);
  }
}
