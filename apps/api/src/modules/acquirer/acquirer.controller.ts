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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const ACQUIRER_WRITE_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'FINANCIAL'] as const;

@ApiTags('acquirers')
@ApiBearerAuth()
@Controller('acquirers')
export class AcquirerController {
  constructor(private readonly acquirerService: AcquirerService) {}

  @Post()
  @Roles(...ACQUIRER_WRITE_ROLES)
  @ApiOperation({ summary: 'Criar adquirente de cartão' })
  create(@Body() dto: CreateAcquirerDto, @CurrentUser() user: any) {
    return this.acquirerService.create(dto, user);
  }

  @Get()
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
  @Roles(...ACQUIRER_WRITE_ROLES)
  @ApiOperation({ summary: 'Atualizar taxa MDR' })
  updateFee(
    @Param('feeId') feeId: string,
    @Body() dto: UpdateAcquirerFeeDto,
    @CurrentUser() user: any,
  ) {
    return this.acquirerService.updateFee(feeId, dto, user);
  }

  @Get(':id/fees/resolve')
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
  @Roles(...ACQUIRER_WRITE_ROLES)
  @ApiOperation({ summary: 'Adicionar taxa MDR à adquirente' })
  addFee(
    @Param('id') id: string,
    @Body() dto: CreateAcquirerFeeDto,
    @CurrentUser() user: any,
  ) {
    return this.acquirerService.addFee(id, dto, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar adquirente por ID (com taxas)' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.acquirerService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @Roles(...ACQUIRER_WRITE_ROLES)
  @ApiOperation({ summary: 'Atualizar adquirente' })
  update(@Param('id') id: string, @Body() dto: UpdateAcquirerDto, @CurrentUser() user: any) {
    return this.acquirerService.update(id, dto, user);
  }
}
