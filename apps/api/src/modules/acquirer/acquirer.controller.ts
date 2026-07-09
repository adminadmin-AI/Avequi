import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PaymentModality } from '@prisma/client';
import { AcquirerService } from './acquirer.service';
import { CreateAcquirerDto } from './dto/create-acquirer.dto';
import { UpdateAcquirerDto } from './dto/update-acquirer.dto';
import { CreateAcquirerFeeDto } from './dto/create-acquirer-fee.dto';
import { UpdateAcquirerFeeDto } from './dto/update-acquirer-fee.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR E1): gate único RBAC v2 — @Roles legado removido (matriz
 * Rafael, issue #623). FIX: os GETs estavam SEM gate (qualquer autenticado via
 * as taxas de cartão negociadas); agora finance.acquirers.view é restrita a
 * FINANCEIRO/G.FINANCEIRO/AUDITOR/admins; manage é G.FINANCEIRO/admins.
 */
@ApiTags('acquirers')
@ApiBearerAuth()
@Controller('acquirers')
export class AcquirerController {
  constructor(private readonly acquirerService: AcquirerService) {}

  @Post()
  @RequirePermission('finance.acquirers.manage')
  @ApiOperation({ summary: 'Criar adquirente de cartão' })
  create(@Body() dto: CreateAcquirerDto, @CurrentUser() user: any) {
    return this.acquirerService.create(dto, user);
  }

  @Get()
  @RequirePermission('finance.acquirers.view')
  @ApiOperation({ summary: 'Listar adquirentes (com taxas ativas)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.acquirerService.findAll(user.companyId, { search, isActive });
  }

  // ── rotas estáticas ANTES de :id (regra do projeto) ──────────────────────

  @Patch('fees/:feeId')
  @RequirePermission('finance.acquirers.manage')
  @ApiOperation({ summary: 'Atualizar taxa MDR' })
  updateFee(
    @Param('feeId') feeId: string,
    @Body() dto: UpdateAcquirerFeeDto,
    @CurrentUser() user: any,
  ) {
    return this.acquirerService.updateFee(feeId, dto, user);
  }

  @Get(':id/fees/resolve')
  @RequirePermission('finance.acquirers.view')
  @ApiOperation({ summary: 'Resolver taxa vigente (bandeira/modalidade/parcelas/data)' })
  @ApiQuery({ name: 'modality', enum: PaymentModality })
  @ApiQuery({ name: 'installments', required: false })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'date', required: false, description: 'ISO; default = agora' })
  async resolveFee(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query('modality') modality: PaymentModality,
    @Query('installments') installments?: string,
    @Query('brand') brand?: string,
    @Query('date') date?: string,
  ) {
    const resolved = await this.acquirerService.resolveFee(user.companyId, {
      acquirerId: id,
      brand,
      modality,
      installments: installments ? parseInt(installments, 10) : 1,
      date: date ? new Date(date) : undefined,
    });
    if (!resolved) {
      throw new NotFoundException(
        'Nenhuma taxa vigente para essa combinação (bandeira/modalidade/parcelas). Cadastre a taxa da adquirente.',
      );
    }
    return resolved;
  }

  @Post(':id/fees')
  @RequirePermission('finance.acquirers.manage')
  @ApiOperation({ summary: 'Adicionar taxa MDR à adquirente' })
  addFee(
    @Param('id') id: string,
    @Body() dto: CreateAcquirerFeeDto,
    @CurrentUser() user: any,
  ) {
    return this.acquirerService.addFee(id, dto, user);
  }

  @Get(':id')
  @RequirePermission('finance.acquirers.view')
  @ApiOperation({ summary: 'Buscar adquirente por ID (com taxas)' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.acquirerService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('finance.acquirers.manage')
  @ApiOperation({ summary: 'Atualizar adquirente' })
  update(@Param('id') id: string, @Body() dto: UpdateAcquirerDto, @CurrentUser() user: any) {
    return this.acquirerService.update(id, dto, user);
  }
}
