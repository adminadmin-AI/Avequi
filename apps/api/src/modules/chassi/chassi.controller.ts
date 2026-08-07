import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChassiService } from './chassi.service';

/**
 * Consulta dos chassis gravados pela marcadora (OpenClaw) — somente leitura.
 * Issue #889. Sem companyId nas tabelas (decisão #782): gate por RBAC.
 */
@Controller('chassi')
export class ChassiController {
  constructor(private readonly chassiService: ChassiService) {}

  @Get('gravacoes')
  @RequirePermission('production.chassi.view')
  listarGravacoes(
    @Query('vin') vin?: string,
    @Query('tipo') tipo?: string,
    @Query('status') status?: string,
    @Query('quadroCodigo') quadroCodigo?: string,
    @Query('ano') ano?: string,
  ) {
    return this.chassiService.listarGravacoes({
      vin, tipo, status, quadroCodigo,
      ano: ano ? Number(ano) : undefined,
    });
  }

  @Get('gravacoes/:id')
  @RequirePermission('production.chassi.view')
  detalheGravacao(@Param('id', ParseIntPipe) id: number) {
    return this.chassiService.detalheGravacao(id);
  }

  @Get('series')
  @RequirePermission('production.chassi.view')
  painelSeries() {
    return this.chassiService.painelSeries();
  }
}
