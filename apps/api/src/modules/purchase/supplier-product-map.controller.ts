import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SupplierProductMapService } from './supplier-product-map.service';
import {
  ApplyDto,
  ClassifyDto,
  ConfirmProductDto,
  ListSupplierProductMapsQueryDto,
  OptionalReasonDto,
  ReasonDto,
  SuggestDto,
} from './dto/supplier-product-map.dto';

/**
 * Fase 2 PR-2 (#609) — conciliação fornecedor+cProd → Product.
 *
 * O par é endereçado pela identidade canônica (supplierId, cProd) — o cProd
 * vai na URL codificado (`encodeURIComponent`), preservando zeros à esquerda,
 * barras e espaços internos. O mapa nasce na primeira decisão; listar não
 * escreve nada.
 *
 * Permissões: `purchases.supplier-map.view` (ver/priorizar) e
 * `purchases.supplier-map.resolve` (confirmar/classificar/sugerir/rever).
 */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase/supplier-product-maps')
export class SupplierProductMapController {
  constructor(private readonly service: SupplierProductMapService) {}

  @Get()
  @RequirePermission('purchases.supplier-map.view')
  @ApiOperation({ summary: 'Pares (fornecedor, cProd) com métricas de compra, estado canônico, sugestão e prioridade (BOM ativa → valor → recorrência)' })
  list(@CurrentUser() user: any, @Query() q: ListSupplierProductMapsQueryDto) {
    return this.service.listPairs(user.companyId, q);
  }

  @Get('summary')
  @RequirePermission('purchases.supplier-map.view')
  @ApiOperation({ summary: 'Cobertura: pares por status, valor resolvido, quantos faltam para ~80% do valor, pendentes ligados a BOM ativa' })
  summary(@CurrentUser() user: any) {
    return this.service.summary(user.companyId);
  }

  @Get('bom-coverage')
  @RequirePermission('purchases.supplier-map.view')
  @ApiOperation({ summary: 'Componentes comprados das BOMs ativas × de-para confirmado (o que ainda impede calcular custo)' })
  bomCoverage(@CurrentUser() user: any) {
    return this.service.bomCoverage(user.companyId);
  }

  @Get('pairs/:supplierId/:code')
  @RequirePermission('purchases.supplier-map.view')
  @ApiOperation({ summary: 'Detalhe de um par com histórico de decisões (eventos)' })
  getPair(@CurrentUser() user: any, @Param('supplierId') supplierId: string, @Param('code') code: string) {
    return this.service.getPair(user.companyId, { supplierId, supplierProductCode: decodeURIComponent(code) });
  }

  @Post('pairs/:supplierId/:code/confirm-product')
  @RequirePermission('purchases.supplier-map.resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmar (ou trocar) o Product canônico do par — decisão humana, auditada' })
  confirmProduct(@CurrentUser() user: any, @Param('supplierId') supplierId: string, @Param('code') code: string, @Body() dto: ConfirmProductDto) {
    return this.service.confirmProduct(user.companyId, { supplierId, supplierProductCode: decodeURIComponent(code) }, dto.productId, user.id, dto.reason);
  }

  @Post('pairs/:supplierId/:code/classify')
  @RequirePermission('purchases.supplier-map.resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Classificar como CONSUMABLE / ASSET / FREIGHT_OTHER (conciliado sem Product)' })
  classify(@CurrentUser() user: any, @Param('supplierId') supplierId: string, @Param('code') code: string, @Body() dto: ClassifyDto) {
    return this.service.classify(user.companyId, { supplierId, supplierProductCode: decodeURIComponent(code) }, dto.kind, user.id, dto.reason);
  }

  @Post('pairs/:supplierId/:code/suggest')
  @RequirePermission('purchases.supplier-map.resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registrar uma sugestão (Product e/ou kind) — nunca confirma' })
  suggest(@CurrentUser() user: any, @Param('supplierId') supplierId: string, @Param('code') code: string, @Body() dto: SuggestDto) {
    return this.service.suggest(user.companyId, { supplierId, supplierProductCode: decodeURIComponent(code) }, { productId: dto.productId ?? null, kind: dto.kind ?? null, source: 'MANUAL', rationale: dto.rationale }, user.id);
  }

  @Post('pairs/:supplierId/:code/dismiss-suggestion')
  @RequirePermission('purchases.supplier-map.resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Descartar a sugestão (volta a UNRESOLVED; a sugestão fica na história)' })
  dismissSuggestion(@CurrentUser() user: any, @Param('supplierId') supplierId: string, @Param('code') code: string, @Body() dto: OptionalReasonDto) {
    return this.service.dismissSuggestion(user.companyId, { supplierId, supplierProductCode: decodeURIComponent(code) }, user.id, dto.reason);
  }

  @Post('pairs/:supplierId/:code/review')
  @RequirePermission('purchases.supplier-map.resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reabrir um par confirmado para reavaliação (mantém o vínculo anterior e a trilha)' })
  review(@CurrentUser() user: any, @Param('supplierId') supplierId: string, @Param('code') code: string, @Body() dto: ReasonDto) {
    return this.service.flagReview(user.companyId, { supplierId, supplierProductCode: decodeURIComponent(code) }, user.id, dto.reason);
  }

  @Post('suggestions/description')
  @RequirePermission('purchases.supplier-map.resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sugestões por descrição (Jaccard de tokens, sem NCM, sem IA): apply=false só prévia; apply=true grava SUGGESTED' })
  async descriptionSuggestions(@CurrentUser() user: any, @Body() dto: ApplyDto) {
    if (dto.apply) return this.service.applyDescriptionSuggestions(user.companyId, user.id);
    return this.service.previewDescriptionSuggestions(user.companyId);
  }

  @Get('divergences')
  @RequirePermission('purchases.supplier-map.view')
  @ApiOperation({ summary: 'Pares CONFIRMED cuja descrição mais recente diverge da confirmada (candidatos a REVIEW)' })
  divergences(@CurrentUser() user: any) {
    return this.service.detectDivergences(user.companyId);
  }
}
