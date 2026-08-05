import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ContractPdfService } from './contract-pdf.service';
import { OPS_THROTTLE } from './ops-hardening.constants';
import { OpsMfaGuard } from './ops-mfa.guard';
import { OpsSessionGuard } from './ops-session.guard';

/**
 * ContractController — AVECCHI P2 (#992): contrato de prestação de serviços
 * em PDF, gerado on-demand dos dados vivos da conta. Mesmo domínio (e gate)
 * do billing: ops.billing.view — nenhuma permissão nova, nenhum seed.
 * Blindagem padrão do módulo ops (MFA + sessão curta + throttle).
 */
@ApiTags('ops')
@ApiBearerAuth()
@Throttle(OPS_THROTTLE)
@UseGuards(OpsMfaGuard, OpsSessionGuard)
@Controller('ops')
export class ContractController {
  constructor(private readonly contractPdf: ContractPdfService) {}

  @Get('tenants/:id/contract')
  @RequirePermission('ops.billing.view')
  @ApiOperation({
    summary:
      'Contrato de prestação de serviços em PDF (minuta AVQ-CT, dados vivos da assinatura) — exige assinatura ativa',
  })
  async contract(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.contractPdf.generate(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
