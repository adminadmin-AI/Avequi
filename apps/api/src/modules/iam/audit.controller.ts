import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

/**
 * Consulta de audit logs v2 (issue #343) — ROTA NOVA sob /iam, deliberadamente
 * separada de qualquer rota de auditoria legada (a tela existente do frontend
 * migra para cá quando a #352 chegar). Restrita a SUPER_ADMIN e sempre
 * escopada pela companyId do JWT.
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('SUPER_ADMIN')
  @ApiOperation({
    summary:
      'Listar audit logs v2 (paginado; filtros por entidade, usuário, ação e período) — SUPER_ADMIN',
  })
  async list(@CurrentUser() user: any, @Query() query: AuditLogQueryDto) {
    return this.auditService.findLogs(user.companyId, query);
  }
}
