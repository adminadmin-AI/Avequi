import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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

  // #341 (F5.1, dogfooding): primeira rota com enforcement RBAC v2. Os dois
  // decorators convivem: @Roles (enum legado) corta primeiro no RolesGuard;
  // @RequirePermission refina no PermissionGuard (exige o code do catálogo,
  // resolvido via UserRoleAssignment/UserPermission com cache Redis).
  @Get()
  @Roles('SUPER_ADMIN')
  @RequirePermission('iam.audit-logs.view')
  @ApiOperation({
    summary:
      'Listar audit logs v2 (paginado; filtros por entidade, usuário, ação e período) — SUPER_ADMIN',
  })
  async list(@CurrentUser() user: any, @Query() query: AuditLogQueryDto) {
    return this.auditService.findLogs(user.companyId, query);
  }
}
