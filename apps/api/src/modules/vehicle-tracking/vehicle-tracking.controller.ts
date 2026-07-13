import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  Header,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AtpveStatus, BinRegistrationStatus } from '@prisma/client';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { BinRegistrationService } from './bin-registration.service';
import { AtpveService } from './atpve.service';
import { RenaveOrchestratorService } from './renave-orchestrator.service';
import { CreateBinRegistrationDto, UpdateBinRegistrationDto } from './dto/bin-registration.dto';
import { CreateAtpveDto, UpdateAtpveDto } from './dto/atpve.dto';
import { ReturnManufacturerDto } from './dto/renave.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VEHICLE_JOB_ATPV_EMAIL, VEHICLE_QUEUE, VehicleJobPayload } from './renave.types';

// #341 parte 2 (bloco G): gate unico RBAC v2 (#625).

@ApiTags('vehicle-tracking')
@ApiBearerAuth()
@Controller('vehicle-tracking')
export class VehicleTrackingController {
  constructor(
    private readonly binService: BinRegistrationService,
    private readonly atpveService: AtpveService,
    private readonly orchestrator: RenaveOrchestratorService,
    private readonly prisma: PrismaService,
    @InjectQueue(VEHICLE_QUEUE) private readonly queue: Queue<VehicleJobPayload>,
  ) {}

  // ─── BIN / SENATRAN (#362) ────────────────────────────────────────────────

  @Post('bin')
  @RequirePermission('vehicle-tracking.bin.create')
  @ApiOperation({ summary: 'Criar rastreamento de registro BIN para um chassi' })
  createBin(@CurrentUser() user: any, @Body() dto: CreateBinRegistrationDto) {
    return this.binService.create(user.companyId, dto);
  }

  @Get('bin')
  @RequirePermission('vehicle-tracking.bin.view')
  @ApiOperation({ summary: 'Listar registros BIN (filtro por status)' })
  findAllBin(@CurrentUser() user: any, @Query('status') status?: BinRegistrationStatus) {
    return this.binService.findAll(user.companyId, status);
  }

  @Get('bin/pending')
  @RequirePermission('vehicle-tracking.bin.view')
  @ApiOperation({ summary: 'Chassis com dados veiculares ainda sem BIN REGISTERED' })
  findPendingChassis(@CurrentUser() user: any) {
    return this.binService.findPendingChassis(user.companyId);
  }

  @Get('bin/serial/:serialNumberId')
  @RequirePermission('vehicle-tracking.bin.view')
  @ApiOperation({ summary: 'Consultar registro BIN por SerialNumber' })
  findBinBySerial(@Param('serialNumberId') serialNumberId: string, @CurrentUser() user: any) {
    return this.binService.findBySerialNumber(serialNumberId, user.companyId);
  }

  @Patch('bin/:id')
  @RequirePermission('vehicle-tracking.bin.update')
  @ApiOperation({ summary: 'Atualizar status/dados do registro BIN' })
  updateBin(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateBinRegistrationDto) {
    return this.binService.update(id, user.companyId, dto);
  }

  // ─── ATPV-e / RENAVE (#363) ───────────────────────────────────────────────

  @Post('atpve')
  @RequirePermission('vehicle-tracking.atpve.create')
  @ApiOperation({ summary: 'Criar rastreamento de ATPV-e (exige BIN REGISTERED)' })
  createAtpve(@CurrentUser() user: any, @Body() dto: CreateAtpveDto) {
    return this.atpveService.create(user.companyId, dto);
  }

  @Get('atpve')
  @RequirePermission('vehicle-tracking.atpve.view')
  @ApiOperation({ summary: 'Listar ATPV-e (filtro por status)' })
  findAllAtpve(@CurrentUser() user: any, @Query('status') status?: AtpveStatus) {
    return this.atpveService.findAll(user.companyId, status);
  }

  @Get('atpve/pending')
  @RequirePermission('vehicle-tracking.atpve.view')
  @ApiOperation({ summary: 'Vendas de chassis ainda sem ATPV-e emitido' })
  findSalesWithoutAtpve(@CurrentUser() user: any) {
    return this.atpveService.findSalesWithoutAtpve(user.companyId);
  }

  @Get('atpve/:id')
  @RequirePermission('vehicle-tracking.atpve.view')
  @ApiOperation({ summary: 'Consultar ATPV-e por ID' })
  findOneAtpve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.atpveService.findOne(id, user.companyId);
  }

  @Patch('atpve/:id')
  @RequirePermission('vehicle-tracking.atpve.update')
  @ApiOperation({ summary: 'Atualizar status/dados do ATPV-e' })
  updateAtpve(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateAtpveDto) {
    return this.atpveService.update(id, user.companyId, dto);
  }

  // ─── Integração RENAVE/SERPRO (#529-#533) ─────────────────────────────────

  @Get('renave/sales-order/:salesOrderId')
  @RequirePermission('vehicle-tracking.renave.view')
  @ApiOperation({ summary: 'Status consolidado BIN/RENAVE/ATPV-e de uma OV (card #533)' })
  getRenaveStatus(@Param('salesOrderId') salesOrderId: string, @CurrentUser() user: any) {
    return this.orchestrator.getSalesOrderStatus(salesOrderId, user.companyId);
  }

  @Post('renave/operations/:id/retry')
  @RequirePermission('vehicle-tracking.renave.retry')
  @ApiOperation({ summary: 'Re-executar operação RENAVE em ERROR (padrão fiscal.nfe.retry)' })
  retryOperation(@Param('id') id: string, @CurrentUser() user: any) {
    return this.orchestrator.retry(id, user.companyId);
  }

  @Post('renave/devolver-montadora')
  @RequirePermission('vehicle-tracking.renave.manage')
  @ApiOperation({
    summary:
      'Devolução entre estabelecimentos (cenário B #531) — exige chave da NF-e de devolução; disparo manual',
  })
  returnToManufacturer(@CurrentUser() user: any, @Body() dto: ReturnManufacturerDto) {
    return this.orchestrator.returnToManufacturer(
      user.companyId,
      dto.salesOrderId,
      dto.serialNumberId,
      dto.chaveNfeDevolucao,
    );
  }

  @Get('atpve/:id/pdf')
  @RequirePermission('vehicle-tracking.atpve.view')
  @Header('Content-Type', 'application/pdf')
  @ApiOperation({ summary: 'Download do PDF da ATPV-e (binário persistido, #530)' })
  async downloadAtpvePdf(@Param('id') id: string, @CurrentUser() user: any) {
    const record = await this.prisma.atpveRecord.findFirst({
      where: { id, companyId: user.companyId },
      select: { atpvePdfData: true, serialNumber: { select: { chassi: true } } },
    });
    if (!record?.atpvePdfData) {
      throw new NotFoundException('PDF da ATPV-e ainda não disponível');
    }
    return new StreamableFile(Buffer.from(record.atpvePdfData), {
      disposition: `attachment; filename="atpve-${record.serialNumber.chassi ?? id}.pdf"`,
    });
  }

  @Post('atpve/:id/resend-email')
  @RequirePermission('vehicle-tracking.atpve.update')
  @ApiOperation({ summary: 'Reenviar e-mail da ATPV-e ao cliente (best-effort, #530)' })
  async resendAtpveEmail(@Param('id') id: string, @CurrentUser() user: any) {
    const record = await this.prisma.atpveRecord.findFirst({
      where: { id, companyId: user.companyId },
      select: { serialNumberId: true, salesOrderId: true },
    });
    if (!record) throw new NotFoundException('ATPV-e não encontrada');
    const operation = await this.prisma.renaveOperation.findFirst({
      where: {
        serialNumberId: record.serialNumberId,
        salesOrderId: record.salesOrderId,
        type: 'ATPVE_PDF',
      },
      select: { id: true },
    });
    if (!operation) throw new NotFoundException('Operação ATPVE_PDF não encontrada para esta ATPV-e');
    await this.queue.add(VEHICLE_JOB_ATPV_EMAIL, { operationId: operation.id }, { attempts: 1 });
    return { queued: true };
  }
}
