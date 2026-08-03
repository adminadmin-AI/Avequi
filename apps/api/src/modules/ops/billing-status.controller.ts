import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';

/**
 * BillingStatusController — OPS WP5 (#912): status de cobrança da PRÓPRIA
 * conta, consumido pelo app do cliente para o banner de inadimplência
 * (D+3 aviso discreto · D+10 banner persistente). Self-service: qualquer
 * usuário autenticado do tenant pode ler — é a situação da conta dele.
 * Controller separado do /ops (sem OpsMfaGuard, mesmo racional do
 * InviteController do WP2).
 */
@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingStatusController {
  constructor(private readonly billingService: BillingService) {}

  @Get('me/status')
  @ApiOperation({
    summary: 'Status de cobrança da MINHA conta (none | notice D+3 | banner D+10)',
  })
  myStatus(@CurrentUser() user: { companyId: string }) {
    return this.billingService.myBillingStatus(user.companyId);
  }
}
