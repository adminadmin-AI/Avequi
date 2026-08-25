import {
  BadRequestException,
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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ManifestService } from './manifest.service';

/**
 * #341 parte 2 (PR E2): gate único RBAC v2 — @Roles legado removido (decisões
 * Rafael, issue #623). FIX: os 4 GETs estavam SEM gate (qualquer autenticado
 * via a fila de manifestação). sync/execute ficam com FISCAL/admins —
 * GERENTE_FINANCEIRO perdeu a operação (mantém manifestation.view).
 */
import { ManifestActionDto } from './dto/manifest-action.dto';

@ApiTags('Manifestação do Destinatário')
@ApiBearerAuth()
@Controller('fiscal/manifest')
export class ManifestController {
  constructor(private readonly manifestService: ManifestService) {}

  /** Buscar NF-e pendentes de manifestação */
  @Get('pending')
  @RequirePermission('fiscal.manifestation.view')
  @ApiOperation({ summary: 'NF-e aguardando manifestação' })
  findPending(@CurrentUser() user: any) {
    return this.manifestService.findPending(user.companyId);
  }

  /** Estatísticas de manifestação */
  @Get('stats')
  @RequirePermission('fiscal.manifestation.view')
  @ApiOperation({ summary: 'Estatísticas de manifestação por status' })
  getStats(@CurrentUser() user: any) {
    return this.manifestService.getStats(user.companyId);
  }

  /** NF-e vencidas (não manifestadas há mais de 30 dias) */
  @Get('overdue')
  @RequirePermission('fiscal.manifestation.view')
  @ApiOperation({ summary: 'NF-e não manifestadas há mais de 30 dias' })
  findOverdue(@CurrentUser() user: any) {
    return this.manifestService.findOverdue(user.companyId);
  }

  /** Listar todas as manifestações com filtro opcional por status */
  @Get()
  @RequirePermission('fiscal.manifestation.view')
  @ApiOperation({ summary: 'Listar manifestações com filtro por status' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'CIENCIA', 'CONFIRMED', 'NOT_PERFORMED', 'UNKNOWN'] })
  findAll(@CurrentUser() user: any, @Query('status') status?: string) {
    return this.manifestService.findAll(user.companyId, status);
  }

  /** Sincronizar NF-e recebidas da SEFAZ via Focus NFe */
  @Post('sync')
  @RequirePermission('fiscal.manifestation.sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sincronizar NF-e destinadas via Focus NFe' })
  sync(@CurrentUser() user: any) {
    return this.manifestService.syncReceivedNfes(user.companyId);
  }

  /** Focus-A (#608): estado do cursor/último sync desta company */
  @Get('sync/state')
  @RequirePermission('fiscal.manifestation.view')
  @ApiOperation({ summary: 'Estado da sincronização incremental de NF-e recebidas (cursor, último sync)' })
  syncState(@CurrentUser() user: any) {
    return this.manifestService.getSyncState(user.companyId);
  }

  /** Registrar ciência da operação */
  @Post(':chaveNfe/ciencia')
  @RequirePermission('fiscal.manifestation.execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registrar ciência da operação (evento 210210)' })
  ciencia(@Param('chaveNfe') chaveNfe: string, @CurrentUser() user: any) {
    return this.manifestService.registerCiencia(chaveNfe, user.companyId, user.id);
  }

  /** Confirmar operação */
  @Post(':chaveNfe/confirm')
  @RequirePermission('fiscal.manifestation.execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmar operação (evento 210200)' })
  confirm(@Param('chaveNfe') chaveNfe: string, @CurrentUser() user: any) {
    return this.manifestService.confirmOperation(chaveNfe, user.companyId, user.id);
  }

  /** Operação não realizada */
  @Post(':chaveNfe/reject')
  @RequirePermission('fiscal.manifestation.execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Operação não realizada (evento 210220)' })
  reject(
    @Param('chaveNfe') chaveNfe: string,
    @Body() dto: ManifestActionDto,
    @CurrentUser() user: any,
  ) {
    if (!dto.justificativa) {
      throw new BadRequestException('Justificativa é obrigatória para operação não realizada');
    }
    return this.manifestService.rejectOperation(chaveNfe, user.companyId, user.id, dto.justificativa);
  }

  /** Desconhecimento da operação */
  @Post(':chaveNfe/unknown')
  @RequirePermission('fiscal.manifestation.execute')
  @HttpCode(200)
  @ApiOperation({ summary: 'Desconhecimento da operação (evento 210240)' })
  unknown(
    @Param('chaveNfe') chaveNfe: string,
    @Body() dto: ManifestActionDto,
    @CurrentUser() user: any,
  ) {
    if (!dto.justificativa) {
      throw new BadRequestException('Justificativa é obrigatória para desconhecimento da operação');
    }
    return this.manifestService.unknownOperation(chaveNfe, user.companyId, user.id, dto.justificativa);
  }
}
