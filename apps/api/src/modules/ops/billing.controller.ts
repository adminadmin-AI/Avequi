import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { BillingService } from './billing.service';
import {
  PayInvoiceDto,
  UpsertSubscriptionDto,
  VoidInvoiceDto,
} from './dto/billing.dtos';
import { Throttle } from '@nestjs/throttler';
import { OPS_THROTTLE } from './ops-hardening.constants';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';
import { OpsActionContext } from './ops.service';

/**
 * BillingController — OPS WP5 (#912): billing da operadora no portal.
 * Camadas padrão do /ops: ops.billing.* + OpsMfaGuard; mutações auditadas
 * SÍNCRONO no service. Suspensão por inadimplência NÃO acontece aqui — a
 * régua só propõe (alerta D+20); suspender é o PATCH de status do WP1.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Throttle(OPS_THROTTLE)
@UseGuards(OpsMfaGuard, OpsSessionGuard)
@Controller('ops')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  private ctx(
    user: { id: string; companyId: string; sessionId?: string },
    req: Request,
  ): OpsActionContext {
    return {
      userId: user.id,
      actorCompanyId: user.companyId,
      sessionId: user.sessionId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
  }

  @Get('billing')
  @RequirePermission('ops.billing.view')
  @ApiOperation({ summary: 'Operadora — MRR (total/por plano), aging e faturas em aberto' })
  overview() {
    return this.billingService.overview();
  }

  @Post('billing/run')
  @RequirePermission('ops.billing.manage')
  @ApiOperation({
    summary: 'Operadora — roda geração de faturas + régua agora (idempotente; recuperação do cron)',
  })
  async run() {
    const created = await this.billingService.generateInvoices(new Date());
    const dunning = await this.billingService.runDunning(new Date());
    return { invoicesCreated: created, ...dunning };
  }

  @Post('billing/invoices/:invoiceId/pay')
  @RequirePermission('ops.billing.manage')
  @ApiOperation({ summary: 'Operadora — baixa MANUAL de fatura (auditada)' })
  pay(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: PayInvoiceDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.billingService.markPaid(invoiceId, dto.method, this.ctx(user, req));
  }

  @Post('billing/invoices/:invoiceId/void')
  @RequirePermission('ops.billing.manage')
  @ApiOperation({ summary: 'Operadora — anula fatura (motivo obrigatório, auditada)' })
  void(
    @Param('invoiceId') invoiceId: string,
    @Body() dto: VoidInvoiceDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.billingService.voidInvoice(invoiceId, dto.reason, this.ctx(user, req));
  }

  @Get('tenants/:id/billing')
  @RequirePermission('ops.billing.view')
  @ApiOperation({ summary: 'Operadora — assinatura + faturas do tenant' })
  tenantBilling(@Param('id') id: string) {
    return this.billingService.tenantBilling(id);
  }

  @Put('tenants/:id/subscription')
  @RequirePermission('ops.billing.manage')
  @ApiOperation({
    summary:
      'Operadora — cria/atualiza a assinatura do tenant (valor negociado + dia de vencimento). ' +
      'Editar reativa assinatura cancelada.',
  })
  upsertSubscription(
    @Param('id') id: string,
    @Body() dto: UpsertSubscriptionDto,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.billingService.upsertSubscription(id, dto, this.ctx(user, req));
  }

  @Post('tenants/:id/subscription/cancel')
  @RequirePermission('ops.billing.manage')
  @ApiOperation({ summary: 'Operadora — cancela a assinatura (faturas existentes seguem cobráveis)' })
  cancelSubscription(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; companyId: string; sessionId?: string },
    @Req() req: Request,
  ) {
    return this.billingService.cancelSubscription(id, this.ctx(user, req));
  }
}
