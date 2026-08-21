import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import type { Response } from 'express';
import archiver = require('archiver');
import { FiscalDirection, FiscalDocumentType } from '@prisma/client';

/**
 * Fase 1: valida o filtro opcional `direction` da query string. Valor fora do
 * enum vira 400 em vez de um `where` inválido no Prisma.
 */
export function parseDirection(raw?: string): FiscalDirection | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === FiscalDirection.EMITIDA || raw === FiscalDirection.RECEBIDA) return raw;
  throw new BadRequestException(`direction inválida: ${raw} (use EMITIDA ou RECEBIDA)`);
}
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FiscalService } from './fiscal.service';
import { ComplianceService } from './compliance.service';
import { CancelFiscalDto } from './dto/cancel-fiscal.dto';
import { CorrectionFiscalDto } from './dto/correction-fiscal.dto';
import { CreditNoteFiscalDto, DebitNoteFiscalDto, PreviewAdjustmentFiscalDto } from './dto/adjustment-note-fiscal.dto';
import { ReturnNoteFiscalDto } from './dto/return-note-fiscal.dto';
import { VoidRangeFiscalDto } from './dto/void-range-fiscal.dto';
import { AdjustmentSpec } from './ibscbs-adjustment.service';

/** Resolve o modo do ajuste — exatamente UM entre full/totalDelta/itemDeltas/amount (#757) */
function adjustmentSpecFromDto(dto: {
  full?: boolean;
  totalDelta?: number;
  itemDeltas?: Array<{ fiscalDocumentItemId: string; baseDelta: number }>;
  amount?: number;
  description?: string;
}): AdjustmentSpec {
  const modes = [dto.full, dto.totalDelta != null, !!dto.itemDeltas?.length, dto.amount != null].filter(Boolean);
  if (modes.length !== 1) {
    throw new BadRequestException('Informe exatamente um modo: full | totalDelta | itemDeltas | amount.');
  }
  if (dto.full) return { mode: 'FULL' };
  if (dto.amount != null) return { mode: 'AMOUNT', amount: dto.amount, description: dto.description };
  if (dto.totalDelta != null) return { mode: 'TOTAL', totalDelta: dto.totalDelta };
  return { mode: 'ITEMS', itemDeltas: dto.itemDeltas! };
}

@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal')
export class FiscalController {
  private readonly logger = new Logger(FiscalController.name);

  constructor(
    private readonly fiscalService: FiscalService,
    private readonly complianceService: ComplianceService,
    private readonly config: ConfigService,
  ) {}

  // #503 parte 2 — Compliance Center (rota estática ANTES de :id)
  @Get('compliance')
  @RequirePermission('fiscal.documents.view')
  @ApiOperation({
    summary:
      'Compliance Center: score de conformidade + prontidão Reforma (cClassTrib/NCM) + ' +
      'cobertura de regras vigentes + saúde de emissão 30d + pendências veiculares (#503)',
  })
  compliance(@CurrentUser() user: any) {
    return this.complianceService.overview(user.companyId);
  }

  /** S08.04 — Webhook da Focus NFe (autenticado por secret no header) */
  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de retorno assíncrono da Focus NFe' })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-focus-token') focusToken?: string,
  ) {
    const secret = this.config.get<string>('FOCUS_NFE_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('FOCUS_NFE_WEBHOOK_SECRET not configured — rejecting webhook');
      throw new UnauthorizedException('Webhook secret not configured');
    }
    if (!focusToken) {
      throw new UnauthorizedException('Missing webhook token');
    }
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(focusToken, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook token');
    }

    await this.fiscalService.handleWebhook(body);
    return { ok: true };
  }

  /** #164 — Cancelar NF-e autorizada (prazo de 24h) */
  @Post(':id/cancel')
  @RequirePermission('fiscal.nfe.cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancelar documento fiscal autorizado (prazo de 24h)' })
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelFiscalDto,
    @CurrentUser() user: any,
  ) {
    await this.fiscalService.cancel(id, user.companyId, dto.justificativa);
    return { ok: true, message: 'Documento fiscal cancelado com sucesso' };
  }

  /** #165 — CC-e (Carta de Correção) */
  @Post(':id/correction')
  @RequirePermission('fiscal.nfe.correct')
  @HttpCode(200)
  @ApiOperation({ summary: 'Emitir Carta de Correção (CC-e) para NF-e autorizada' })
  async correction(
    @Param('id') id: string,
    @Body() dto: CorrectionFiscalDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.fiscalService.correction(id, user.companyId, dto.correcao);
    return { ok: true, ...result };
  }

  /** #747 — NF-e de devolução referenciada (entrada, finNFe 4, CFOP 1202/2202) */
  @Post(':id/return-note')
  @RequirePermission('fiscal.nfe.return-note')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Emitir NF-e de devolução referenciando a NF-e original (:id). Exige OV RETURNED e original AUTHORIZED.',
  })
  async returnNote(
    @Param('id') id: string,
    @Body() dto: ReturnNoteFiscalDto,
    @CurrentUser() user: any,
  ) {
    await this.fiscalService.emitReturnNote(id, user.companyId, dto.motivo);
    return { ok: true, message: 'NF-e de devolução em processamento' };
  }

  /** #758 — Preview da nota de ajuste (motor #755, sem persistir/transmitir) */
  @Post(':id/adjustment-preview')
  @RequirePermission('fiscal.documents.view')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Calcular o preview da diferença IBS/CBS (nota de débito/crédito) sobre a NF-e original (:id) — leitura, não emite.',
  })
  async adjustmentPreview(
    @Param('id') id: string,
    @Body() dto: PreviewAdjustmentFiscalDto,
    @CurrentUser() user: any,
  ) {
    const result = await this.fiscalService.previewAdjustment(id, user.companyId, adjustmentSpecFromDto(dto));
    return { ok: true, ...result };
  }

  /** #757 — Nota de Débito IBS/CBS (finNFe 6, SINIEF 49/2025) referenciando a NF-e original */
  @Post(':id/debit-note')
  @RequirePermission('fiscal.nfe.debit-note')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Emitir Nota de Débito IBS/CBS (finNFe 6) referenciando a NF-e original (:id). Só IBS/CBS; original AUTHORIZED.',
  })
  async debitNote(
    @Param('id') id: string,
    @Body() dto: DebitNoteFiscalDto,
    @CurrentUser() user: any,
  ) {
    await this.fiscalService.emitAdjustmentNote(id, user.companyId, 'DEBITO', {
      tipo: dto.tipo,
      spec: adjustmentSpecFromDto(dto),
      justificativa: dto.justificativa,
    });
    return { ok: true, message: 'Nota de débito em processamento' };
  }

  /** #757 — Nota de Crédito IBS/CBS (finNFe 5, SINIEF 49/2025) referenciando a NF-e original */
  @Post(':id/credit-note')
  @RequirePermission('fiscal.nfe.credit-note')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Emitir Nota de Crédito IBS/CBS (finNFe 5) referenciando a NF-e original (:id). Só IBS/CBS; original AUTHORIZED.',
  })
  async creditNote(
    @Param('id') id: string,
    @Body() dto: CreditNoteFiscalDto,
    @CurrentUser() user: any,
  ) {
    await this.fiscalService.emitAdjustmentNote(id, user.companyId, 'CREDITO', {
      tipo: dto.tipo,
      spec: adjustmentSpecFromDto(dto),
      justificativa: dto.justificativa,
    });
    return { ok: true, message: 'Nota de crédito em processamento' };
  }

  /** #165 — Inutilização de faixa de numeração */
  @Post('void-range')
  @RequirePermission('fiscal.nfe.void-range')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inutilizar faixa de numeração de NF-e' })
  async voidRange(@Body() dto: VoidRangeFiscalDto, @CurrentUser() user: any) {
    const result = await this.fiscalService.voidRange(
      user.companyId, dto.serie, dto.numberStart, dto.numberEnd, dto.justificativa,
    );
    return { ok: true, ...result };
  }

  /** S08.05 — Reprocessar documento rejeitado ou em erro */
  @Post(':id/retry')
  @RequirePermission('fiscal.nfe.retry')
  @ApiOperation({ summary: 'Reprocessar documento fiscal rejeitado' })
  async retry(@Param('id') id: string, @CurrentUser() user: any) {
    await this.fiscalService.retry(id, user.companyId);
    return { ok: true };
  }

  @Get()
  @RequirePermission('fiscal.documents.view')
  @ApiOperation({ summary: 'Listar documentos fiscais da empresa' })
  @ApiQuery({ name: 'direction', required: false, enum: FiscalDirection, description: 'Fase 1: EMITIDA | RECEBIDA (sem o parâmetro, todos)' })
  findAll(@CurrentUser() user: any, @Query('direction') direction?: FiscalDirection) {
    return this.fiscalService.findAll(user.companyId, parseDirection(direction));
  }

  /**
   * #482 — ZIP com os XMLs do período para o contador (guarda de 5 anos).
   * Declarado ANTES de :id para não ser capturado pela rota de detalhe.
   */
  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // #349: exports 10/min por usuário
  @RequirePermission('fiscal.documents.export')
  @ApiOperation({ summary: 'Exportar XMLs do período em ZIP (contador)' })
  @ApiQuery({ name: 'from', description: 'Data inicial (YYYY-MM-DD)' })
  @ApiQuery({ name: 'to', description: 'Data final (YYYY-MM-DD)' })
  @ApiQuery({ name: 'type', required: false, enum: FiscalDocumentType })
  @ApiQuery({ name: 'direction', required: false, enum: FiscalDirection })
  async export(
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('type') type?: FiscalDocumentType,
    @Query('direction') direction?: FiscalDirection,
  ) {
    const fromDate = new Date(`${from}T00:00:00-03:00`);
    const toDate = new Date(`${to}T23:59:59.999-03:00`);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new BadRequestException('Parâmetros from/to inválidos — use YYYY-MM-DD');
    }

    const xmls = await this.fiscalService.listXmlsForExport(
      user.companyId,
      fromDate,
      toDate,
      type,
      parseDirection(direction),
    );
    if (xmls.length === 0) {
      throw new NotFoundException('Nenhum XML no período informado');
    }

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="xmls-nfe-${from}_${to}.zip"`,
    });

    const zip = archiver('zip', { zlib: { level: 9 } });
    zip.on('error', (err) => {
      this.logger.error(`Erro ao gerar ZIP de XMLs: ${err.message}`);
      res.destroy(err);
    });
    zip.pipe(res);
    for (const f of xmls) zip.append(f.xml, { name: f.name });
    await zip.finalize();
  }

  @Get(':id')
  @RequirePermission('fiscal.documents.view')
  @ApiOperation({ summary: 'Detalhe do documento fiscal' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.fiscalService.findOne(id, user.companyId);
  }
}
