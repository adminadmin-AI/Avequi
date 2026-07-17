import { Body, Controller, Get, Post, Request } from '@nestjs/common';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { SupportService } from './support.service';

/**
 * Suporte (épico #764). Reportar e ver os PRÓPRIOS chamados é self-service —
 * sem @RequirePermission de propósito: bloquear reporte de bug por falta de
 * permissão seria errado. As duas rotas estão em SELF_SERVICE_OK no
 * route-gate-coverage.spec (autenticado-por-design). Rotas de gestão/triagem
 * (ver todos os chamados) virão com permissão própria em WPs futuros.
 */
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('incidents')
  create(
    @Request() req: { user: { companyId: string; id: string } },
    @Body() dto: CreateIncidentDto,
  ) {
    return this.supportService.createIncident(req.user.companyId, dto, req.user.id);
  }

  @Get('incidents')
  listMine(@Request() req: { user: { companyId: string; id: string } }) {
    return this.supportService.listMine(req.user.companyId, req.user.id);
  }
}
