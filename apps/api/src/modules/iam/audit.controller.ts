import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditService } from './audit.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

/**
 * Consulta de audit logs v2 (issue #343) — ROTA NOVA sob /iam, deliberadamente
 * separada de qualquer rota de auditoria legada (a tela existente do frontend
 * migra para cá quando a #352 chegar). Sempre escopada pela companyId do JWT.
 *
 * Gate ÚNICO = RBAC v2 via @RequirePermission('iam.audit-logs.view') — #341
 * parte 2. Removido o @Roles('SUPER_ADMIN') legado que era redundante E
 * incorreto: ele bloqueava ADMIN_EMPRESA e AUDITOR, que TÊM a permissão pela
 * matriz aprovada (#341). Quem vê: ADMIN_GLOBAL, ADMIN_EMPRESA, AUDITOR.
 * DIRETOR continua SEM iam.audit-logs.view (decisão Rafael, #341) → segue fora.
 */
@ApiTags('iam')
@ApiBearerAuth()
@Controller('iam/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // #341 parte 2: gate ÚNICO = @RequirePermission (PermissionGuard resolve o
  // code do catálogo via UserRoleAssignment/UserPermission com cache Redis).
  @Get()
  @RequirePermission('iam.audit-logs.view')
  @ApiOperation({
    summary:
      'Listar audit logs v2 (paginado; filtros por entidade, usuário, ação e período) — requer iam.audit-logs.view',
  })
  async list(@CurrentUser() user: any, @Query() query: AuditLogQueryDto) {
    return this.auditService.findLogs(user.companyId, query);
  }
}
