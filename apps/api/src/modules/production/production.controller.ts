import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductionOrderStatus } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { CreateProductionLogDto } from './dto/create-log.dto';
import { DispatchRequestDto } from './dto/dispatch.dto';
import { DispatchResponseDto } from './dto/dispatch-response.dto';
import { DispatchService } from './dispatch.service';
import { DispatchResult } from './dispatch.types';
import { ProductionService } from './production.service';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 *
 * Ciclo da OP no desenho v2 (decisão Rafael): PCP cria/planeja (create),
 * supervisor/gerência libera e conclui (release/complete/cancel), operador
 * inicia e aponta (start/execute), qualidade aprova/reprova inspeção.
 */
@ApiTags('production')
@ApiBearerAuth()
@Controller('production')
export class ProductionController {
  constructor(
    private readonly productionService: ProductionService,
    private readonly dispatchService: DispatchService,
  ) {}

  /**
   * #817 — POST /production/dispatch
   *
   * Consulta, apesar do verbo: recebe um carrinho estruturado com vários
   * produtos e quantidades, o que não cabe em query string, e **não grava
   * nada**. POST é o verbo adequado para consulta complexa com corpo.
   *
   * Permissão PRÓPRIA (`production.dispatch.view`), não reaproveitada de
   * `production.orders.view`: ver o despacho da fábrica pode ser liberado a
   * perfis diferentes dos que administram Ordens de Produção.
   */
  @Post('dispatch')
  @RequirePermission('production.dispatch.view')
  @ApiOperation({
    summary: 'Despacho por setor (OS/OC) a partir de um carrinho de modelos',
    description:
      'Explode a BOM do carrinho e devolve, por centro de trabalho, o que cada operação produz (OS) ' +
      'e o que ela precisa receber (OC = o próprio item vindo da operação anterior + os componentes ' +
      'alocados à operação). Somente leitura: nenhum registro é criado. Itens que não puderem ser ' +
      'roteados voltam no bloco de pendências, com motivo estruturado.',
  })
  @ApiOkResponse({
    type: DispatchResponseDto,
    description:
      'Despacho da fábrica. ATENÇÃO: todas as quantidades são STRING decimal exata (até 4 casas), ' +
      'não number — o cálculo é feito em Decimal e devolver number reintroduziria erro de ponto ' +
      'flutuante. O resultado cobre o tenant inteiro; não há filtro pelo centro de trabalho do ' +
      'usuário (dependeria de vínculo explícito usuário ↔ WorkCenter, que ainda não existe).',
  })
  dispatch(
    @Body() dto: DispatchRequestDto,
    @Request() req: { user: { companyId: string } },
  ): Promise<DispatchResult> {
    return this.dispatchService.dispatch(req.user.companyId, dto);
  }

  // POST /production
  @Post()
  @RequirePermission('production.orders.create')
  create(
    @Body() dto: CreateProductionOrderDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.create(dto, req.user.companyId, req.user.sub);
  }

  // GET /production/metrics/scrap — métricas de refugo (#184)
  @Get('metrics/scrap')
  @RequirePermission('production.orders.view')
  getScrapMetrics(
    @Request() req: { user: { companyId: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('workCenterId') workCenterId?: string,
  ) {
    return this.productionService.getScrapMetrics(req.user.companyId, { from, to, workCenterId });
  }

  // GET /production?status=DRAFT
  @Get()
  @RequirePermission('production.orders.view')
  findAll(
    @Request() req: { user: { companyId: string } },
    @Query('status') status?: ProductionOrderStatus,
  ) {
    return this.productionService.findAll(req.user.companyId, status);
  }

  // GET /production/:id
  @Get(':id')
  @RequirePermission('production.orders.view')
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.findOne(id, req.user.companyId);
  }

  // PATCH /production/:id/release
  @Patch(':id/release')
  @RequirePermission('production.orders.release')
  release(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.release(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/start
  @Patch(':id/start')
  @RequirePermission('production.orders.start')
  start(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.start(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/complete
  @Patch(':id/complete')
  @RequirePermission('production.orders.complete')
  complete(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('producedQty') producedQty?: number,
  ) {
    return this.productionService.complete(id, req.user.companyId, producedQty, req.user.sub);
  }

  // PATCH /production/:id/cancel
  @Patch(':id/cancel')
  @RequirePermission('production.orders.cancel')
  cancel(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.cancel(id, req.user.companyId, req.user.sub);
  }

  // POST /production/:id/logs — registrar apontamento
  @Post(':id/logs')
  @RequirePermission('production.orders.execute')
  addLog(
    @Param('id') id: string,
    @Body() dto: CreateProductionLogDto,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.addLog(id, req.user.companyId, dto, req.user.sub);
  }

  // GET /production/:id/logs — listar apontamentos
  @Get(':id/logs')
  @RequirePermission('production.orders.view')
  getLogs(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getLogs(id, req.user.companyId);
  }

  // GET /production/:id/progress — resumo de progresso
  @Get(':id/progress')
  @RequirePermission('production.orders.view')
  getProgress(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getProgress(id, req.user.companyId);
  }

  // GET /production/:id/cost — custo real da OP (disponível após DONE)
  @Get(':id/cost')
  @RequirePermission('production.orders.view')
  getCost(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.productionService.getCost(id, req.user.companyId);
  }

  // PATCH /production/:id/approve-inspection — aprovar inspeção final (#185)
  @Patch(':id/approve-inspection')
  @RequirePermission('production.orders.approve')
  approveInspection(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
  ) {
    return this.productionService.approveInspection(id, req.user.companyId, req.user.sub);
  }

  // PATCH /production/:id/reject-inspection — rejeitar inspeção final (#185)
  @Patch(':id/reject-inspection')
  @RequirePermission('production.orders.reject')
  rejectInspection(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string; sub: string } },
    @Body('reason') reason: string,
  ) {
    return this.productionService.rejectInspection(id, req.user.companyId, reason, req.user.sub);
  }
}
