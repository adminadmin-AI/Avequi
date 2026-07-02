import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AtpveStatus, BinRegistrationStatus } from '@prisma/client';
import { BinRegistrationService } from './bin-registration.service';
import { AtpveService } from './atpve.service';
import { CreateBinRegistrationDto, UpdateBinRegistrationDto } from './dto/bin-registration.dto';
import { CreateAtpveDto, UpdateAtpveDto } from './dto/atpve.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const WRITE_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'FINANCIAL'] as const;

@ApiTags('vehicle-tracking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vehicle-tracking')
export class VehicleTrackingController {
  constructor(
    private readonly binService: BinRegistrationService,
    private readonly atpveService: AtpveService,
  ) {}

  // ─── BIN / SENATRAN (#362) ────────────────────────────────────────────────

  @Post('bin')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Criar rastreamento de registro BIN para um chassi' })
  createBin(@CurrentUser() user: any, @Body() dto: CreateBinRegistrationDto) {
    return this.binService.create(user.companyId, dto);
  }

  @Get('bin')
  @ApiOperation({ summary: 'Listar registros BIN (filtro por status)' })
  findAllBin(@CurrentUser() user: any, @Query('status') status?: BinRegistrationStatus) {
    return this.binService.findAll(user.companyId, status);
  }

  @Get('bin/pending')
  @ApiOperation({ summary: 'Chassis com dados veiculares ainda sem BIN REGISTERED' })
  findPendingChassis(@CurrentUser() user: any) {
    return this.binService.findPendingChassis(user.companyId);
  }

  @Get('bin/serial/:serialNumberId')
  @ApiOperation({ summary: 'Consultar registro BIN por SerialNumber' })
  findBinBySerial(@Param('serialNumberId') serialNumberId: string, @CurrentUser() user: any) {
    return this.binService.findBySerialNumber(serialNumberId, user.companyId);
  }

  @Patch('bin/:id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Atualizar status/dados do registro BIN' })
  updateBin(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateBinRegistrationDto) {
    return this.binService.update(id, user.companyId, dto);
  }

  // ─── ATPV-e / RENAVE (#363) ───────────────────────────────────────────────

  @Post('atpve')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Criar rastreamento de ATPV-e (exige BIN REGISTERED)' })
  createAtpve(@CurrentUser() user: any, @Body() dto: CreateAtpveDto) {
    return this.atpveService.create(user.companyId, dto);
  }

  @Get('atpve')
  @ApiOperation({ summary: 'Listar ATPV-e (filtro por status)' })
  findAllAtpve(@CurrentUser() user: any, @Query('status') status?: AtpveStatus) {
    return this.atpveService.findAll(user.companyId, status);
  }

  @Get('atpve/pending')
  @ApiOperation({ summary: 'Vendas de chassis ainda sem ATPV-e emitido' })
  findSalesWithoutAtpve(@CurrentUser() user: any) {
    return this.atpveService.findSalesWithoutAtpve(user.companyId);
  }

  @Get('atpve/:id')
  @ApiOperation({ summary: 'Consultar ATPV-e por ID' })
  findOneAtpve(@Param('id') id: string, @CurrentUser() user: any) {
    return this.atpveService.findOne(id, user.companyId);
  }

  @Patch('atpve/:id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Atualizar status/dados do ATPV-e' })
  updateAtpve(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: UpdateAtpveDto) {
    return this.atpveService.update(id, user.companyId, dto);
  }
}
