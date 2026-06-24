import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ManifestService } from './manifest.service';
import { ManifestActionDto } from './dto/manifest-action.dto';

@ApiTags('Manifestação do Destinatário')
@ApiBearerAuth()
@Controller('fiscal/manifest')
export class ManifestController {
  constructor(private readonly manifestService: ManifestService) {}

  /** Buscar NF-e pendentes de manifestação */
  @Get('pending')
  @ApiOperation({ summary: 'NF-e aguardando manifestação' })
  findPending(@CurrentUser() user: any) {
    return this.manifestService.findPending(user.companyId);
  }

  /** Estatísticas de manifestação */
  @Get('stats')
  @ApiOperation({ summary: 'Estatísticas de manifestação por status' })
  getStats(@CurrentUser() user: any) {
    return this.manifestService.getStats(user.companyId);
  }

  /** NF-e vencidas (não manifestadas há mais de 30 dias) */
  @Get('overdue')
  @ApiOperation({ summary: 'NF-e não manifestadas há mais de 30 dias' })
  findOverdue(@CurrentUser() user: any) {
    return this.manifestService.findOverdue(user.companyId);
  }

  /** Listar todas as manifestações com filtro opcional por status */
  @Get()
  @ApiOperation({ summary: 'Listar manifestações com filtro por status' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'CIENCIA', 'CONFIRMED', 'NOT_PERFORMED', 'UNKNOWN'] })
  findAll(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.manifestService.findAll(user.companyId, status);
  }

  /** Sincronizar NF-e recebidas da SEFAZ via Focus NFe */
  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sincronizar NF-e destinadas via Focus NFe' })
  sync(@CurrentUser() user: any) {
    return this.manifestService.syncReceivedNfes(user.companyId);
  }

  /** Registrar ciência da operação */
  @Post(':chaveNfe/ciencia')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registrar ciência da operação (evento 210210)' })
  ciencia(@Param('chaveNfe') chaveNfe: string, @CurrentUser() user: any) {
    return this.manifestService.registerCiencia(chaveNfe, user.companyId, user.id);
  }

  /** Confirmar operação */
  @Post(':chaveNfe/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmar operação (evento 210200)' })
  confirm(@Param('chaveNfe') chaveNfe: string, @CurrentUser() user: any) {
    return this.manifestService.confirmOperation(chaveNfe, user.companyId, user.id);
  }

  /** Operação não realizada */
  @Post(':chaveNfe/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Operação não realizada (evento 210220)' })
  reject(
    @Param('chaveNfe') chaveNfe: string,
    @Body() dto: ManifestActionDto,
    @CurrentUser() user: any,
  ) {
    if (!dto.justificativa) {
      throw new Error('Justificativa é obrigatória para operação não realizada');
    }
    return this.manifestService.rejectOperation(chaveNfe, user.companyId, user.id, dto.justificativa);
  }

  /** Desconhecimento da operação */
  @Post(':chaveNfe/unknown')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desconhecimento da operação (evento 210240)' })
  unknown(
    @Param('chaveNfe') chaveNfe: string,
    @Body() dto: ManifestActionDto,
    @CurrentUser() user: any,
  ) {
    if (!dto.justificativa) {
      throw new Error('Justificativa é obrigatória para desconhecimento da operação');
    }
    return this.manifestService.unknownOperation(chaveNfe, user.companyId, user.id, dto.justificativa);
  }
}
