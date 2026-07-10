import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AtpveStatus, BinRegistrationStatus } from '@prisma/client';
import { BinRegistrationService } from './bin-registration.service';
import { AtpveService } from './atpve.service';
import { CreateBinRegistrationDto, UpdateBinRegistrationDto } from './dto/bin-registration.dto';
import { CreateAtpveDto, UpdateAtpveDto } from './dto/atpve.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// #341 parte 2 (bloco G): gate unico RBAC v2 (#625).

@ApiTags('vehicle-tracking')
@ApiBearerAuth()
@Controller('vehicle-tracking')
export class VehicleTrackingController {
  constructor(
    private readonly binService: BinRegistrationService,
    private readonly atpveService: AtpveService,
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
}
