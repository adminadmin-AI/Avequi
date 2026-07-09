import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MrpService } from './mrp.service';

/**
 * #341 parte 2 (PR D): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #622).
 * MRP é do planejamento: OPERADOR_PCP tem o ciclo completo (view/run/convert).
 */
@ApiTags('MRP')
@Controller('mrp')
export class MrpController {
  constructor(private readonly mrpService: MrpService) {}

  @Post('run')
  @RequirePermission('production.mrp.run')
  @ApiOperation({ summary: 'Disparar nova rodada MRP' })
  run(@Request() req: { user: { companyId: string; sub: string } }) {
    return this.mrpService.run(req.user.companyId, req.user.sub);
  }

  @Get('runs')
  @RequirePermission('production.mrp.view')
  @ApiOperation({ summary: 'Listar rodadas MRP' })
  findAll(@Request() req: { user: { companyId: string } }) {
    return this.mrpService.findAll(req.user.companyId);
  }

  @Get('runs/:id')
  @RequirePermission('production.mrp.view')
  @ApiOperation({ summary: 'Detalhe da rodada com sugestões' })
  findOne(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.findOne(id, req.user.companyId);
  }

  @Get('runs/:id/gaps')
  @RequirePermission('production.mrp.view')
  @ApiOperation({ summary: 'Sugestões com necessidade > 0' })
  findGaps(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.findGaps(id, req.user.companyId);
  }

  @Post('suggestions/:id/convert')
  @RequirePermission('production.mrp.convert')
  @ApiOperation({ summary: 'Converter sugestão MRP em PO (BUY) ou OP (MAKE)' })
  convert(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.convertSuggestion(id, req.user.companyId);
  }

  @Post('suggestions/convert-batch')
  @RequirePermission('production.mrp.convert')
  @ApiOperation({ summary: 'Converter múltiplas sugestões MRP em PO/OP' })
  convertBatch(
    @Body() body: { suggestionIds: string[] },
    @Request() req: { user: { companyId: string } },
  ) {
    return this.mrpService.convertBatch(body.suggestionIds, req.user.companyId);
  }
}
