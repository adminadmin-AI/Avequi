import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AlertType } from '@prisma/client';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AlertService } from './alert.service';

@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  // GET /alerts — apenas alertas ativos (não resolvidos)
  @Get()
  listActive(@Request() req: { user: { companyId: string } }) {
    return this.alertService.listActive(req.user.companyId);
  }

  // GET /alerts/all?resolved=true|false&type=STOCK_MIN
  @Get('all')
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
  runCheck(@Request() req: { user: { companyId: string } }) {
    return this.alertService.runAllChecks(req.user.companyId);
  }

  // PATCH /alerts/:id/resolve
  @Patch(':id/resolve')
  resolve(
    @Param('id') id: string,
    @Request() req: { user: { companyId: string } },
  ) {
    return this.alertService.resolve(id, req.user.companyId);
  }
}
