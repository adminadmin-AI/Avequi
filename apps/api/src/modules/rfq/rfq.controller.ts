import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RfqService } from './rfq.service';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 *
 * FIX anti-IDOR (#622): create não aceita mais companyId do body (vem do JWT)
 * e submitQuote escopa a RFQ + o fornecedor pela empresa do JWT (404 fora).
 */
@ApiTags('rfq')
@ApiBearerAuth()
@Controller('rfq')
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @Post()
  @RequirePermission('purchases.rfq.create')
  @ApiOperation({ summary: 'Criar RFQ (#192)' })
  create(@Body() dto: any, @CurrentUser() user: any) {
    // companyId SEMPRE do JWT (padrão anti-IDOR #450) — descartado se vier no body
    const { companyId: _ignored, ...data } = dto ?? {};
    return this.rfqService.create(data, user.companyId, user?.id);
  }

  @Get()
  @RequirePermission('purchases.rfq.view')
  @ApiOperation({ summary: 'Listar RFQs' })
  findAll(@CurrentUser() user: any) {
    return this.rfqService.findAll(user.companyId);
  }

  @Get(':id')
  @RequirePermission('purchases.rfq.view')
  @ApiOperation({ summary: 'Buscar RFQ por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rfqService.findOne(id, user.companyId);
  }

  @Post(':id/quotes')
  @RequirePermission('purchases.rfq.quote')
  @ApiOperation({ summary: 'Enviar cotação de fornecedor' })
  submitQuote(@Param('id') rfqId: string, @Body() dto: any, @CurrentUser() user: any) {
    return this.rfqService.submitQuote(rfqId, user.companyId, dto);
  }

  @Get(':id/compare')
  @RequirePermission('purchases.rfq.view')
  @ApiOperation({ summary: 'Comparar cotações lado-a-lado' })
  compare(@Param('id') id: string, @CurrentUser() user: any) {
    return this.rfqService.compareQuotes(id, user.companyId);
  }

  @Post('quotes/:quoteId/award')
  @RequirePermission('purchases.rfq.award')
  @ApiOperation({ summary: 'Adjudicar cotação → gerar PO (#192)' })
  award(@Param('quoteId') quoteId: string, @CurrentUser() user: any) {
    return this.rfqService.awardQuote(quoteId, user.companyId, user?.id);
  }
}
