import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Request,
} from '@nestjs/common';
import { AlertType } from '@prisma/client';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AlertService } from './alert.service';

// #341 parte 2 (bloco G): gate unico RBAC v2 - @Roles legado removido (#625).

@Controller('alerts')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  // GET /alerts — apenas alertas ativos (não resolvidos)
  @Get()
  @RequirePermission('dashboard.alerts.view')
  listActive(@Request() req: { user: { companyId: string } }) {
    return this.alertService.listActive(req.user.companyId);
  }

  // GET /alerts/all?resolved=true|false&type=STOCK_MIN
  @Get('all')
  @RequirePermission('dashboard.alerts.view')
  listAll(
    @Request() req: { user: { companyId: string } },
    @Query('resolved') resolved?: string,
    @Query('type') type?: string,
  ) {
    return this.alertService.listAll(req.user.companyId, {
      resolved:
        resolved === 'true' ? true : resolved === 'false' ? false : undefined,
      type: type as AlertType | undefined,
    });
  }

  // POST /alerts/check — trigger manual de todos os checks
  @Post('check')
  @RequirePermission('dashboard.alerts.check')
  runCheck(@Request() req: { user: { companyId: string } }) {
    return this.alertService.runAllChecks(req.user.companyId);
  }

  // PATCH /alerts/:id/resolve
  @Patch(':id/resolve')
  @RequirePermission('dashboard.alerts.resolve')
  resolve(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.alertService.resolve(id, req.user.companyId);
  }
}
