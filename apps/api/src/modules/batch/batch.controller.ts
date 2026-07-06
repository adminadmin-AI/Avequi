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
import { BatchStatus } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { BatchService } from './batch.service';
import { AdjustBatchDto } from './dto/adjust-batch.dto';
import { ConsumeBatchDto } from './dto/consume-batch.dto';
import { CreateBatchDto } from './dto/create-batch.dto';

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
  @Roles('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE', 'PRODUCTION', 'QUALITY')
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
  @Roles('SUPER_ADMIN', 'MANAGER', 'QUALITY', 'WAREHOUSE')
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
  @Roles('SUPER_ADMIN', 'MANAGER', 'PRODUCTION', 'WAREHOUSE')
  consume(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: ConsumeBatchDto,
  ) {
    return this.batchService.consume(id, req.user.companyId, dto, req.user.userId);
  }

  // PATCH /batch/:id/quarantine
  @Patch(':id/quarantine')
  @Roles('SUPER_ADMIN', 'MANAGER', 'QUALITY')
  quarantine(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() body: { reason: string },
  ) {
    return this.batchService.quarantine(id, req.user.companyId, body.reason, req.user.userId);
  }

  // PATCH /batch/:id/release
  @Patch(':id/release')
  @Roles('SUPER_ADMIN', 'MANAGER', 'QUALITY')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
  ) {
    return this.batchService.release(id, req.user.companyId, req.user.userId);
  }

  // PATCH /batch/:id/scrap
  @Patch(':id/scrap')
  @Roles('SUPER_ADMIN', 'MANAGER', 'QUALITY')
  scrap(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() body: { reason: string },
  ) {
    return this.batchService.scrap(id, req.user.companyId, body.reason, req.user.userId);
  }

  // PATCH /batch/:id/adjust
  @Patch(':id/adjust')
  @Roles('SUPER_ADMIN', 'MANAGER', 'WAREHOUSE')
  adjust(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: AdjustBatchDto,
  ) {
    return this.batchService.adjust(id, req.user.companyId, dto, req.user.userId);
  }
}
