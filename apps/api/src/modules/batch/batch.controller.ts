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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BatchService } from './batch.service';
import { AdjustBatchDto } from './dto/adjust-batch.dto';
import { ConsumeBatchDto } from './dto/consume-batch.dto';
import { CreateBatchDto } from './dto/create-batch.dto';

/**
 * #341 parte 2 (PR C): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #621).
 * OPERADOR_PCP cria/consome lote; OPERADOR_PRODUCAO só consome (apontamento);
 * quarentena/liberação/sucata seguem com QUALIDADE/gerência.
 */
@Controller('batch')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  // GET /batch
  @Get()
  @RequirePermission('stock.batches.view')
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
  @RequirePermission('stock.batches.create')
  create(
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: CreateBatchDto,
  ) {
    return this.batchService.create(req.user.companyId, dto, req.user.userId);
  }

  // GET /batch/stats
  @Get('stats')
  @RequirePermission('stock.batches.view')
  getStats(@Request() req: { user: { companyId: string } }) {
    return this.batchService.getStats(req.user.companyId);
  }

  // POST /batch/check-expired
  @Post('check-expired')
  @RequirePermission('stock.batches.check-expired')
  checkExpired(@Request() req: { user: { companyId: string } }) {
    return this.batchService.checkExpired(req.user.companyId);
  }

  // GET /batch/:id
  @Get(':id')
  @RequirePermission('stock.batches.view')
  getById(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.batchService.getById(id, req.user.companyId);
  }

  // GET /batch/:id/traceability
  @Get(':id/traceability')
  @RequirePermission('stock.batches.view')
  getTraceability(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.batchService.getTraceability(id, req.user.companyId);
  }

  // PATCH /batch/:id/consume
  @Patch(':id/consume')
  @RequirePermission('stock.batches.consume')
  consume(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: ConsumeBatchDto,
  ) {
    return this.batchService.consume(id, req.user.companyId, dto, req.user.userId);
  }

  // PATCH /batch/:id/quarantine
  @Patch(':id/quarantine')
  @RequirePermission('stock.batches.quarantine')
  quarantine(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() body: { reason: string },
  ) {
    return this.batchService.quarantine(id, req.user.companyId, body.reason, req.user.userId);
  }

  // PATCH /batch/:id/release
  @Patch(':id/release')
  @RequirePermission('stock.batches.release')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
  ) {
    return this.batchService.release(id, req.user.companyId, req.user.userId);
  }

  // PATCH /batch/:id/scrap
  @Patch(':id/scrap')
  @RequirePermission('stock.batches.scrap')
  scrap(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() body: { reason: string },
  ) {
    return this.batchService.scrap(id, req.user.companyId, body.reason, req.user.userId);
  }

  // PATCH /batch/:id/adjust
  @Patch(':id/adjust')
  @RequirePermission('stock.batches.adjust')
  adjust(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; userId?: string } },
    @Body() dto: AdjustBatchDto,
  ) {
    return this.batchService.adjust(id, req.user.companyId, dto, req.user.userId);
  }
}
