import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { LgpdService } from './lgpd.service';
import { RegisterConsentDto } from './dto/register-consent.dto';

@ApiTags('LGPD')
@ApiBearerAuth()
// Dados pessoais de titulares: acesso restrito mesmo para leitura
/**
 * #341 parte 2 (PR E2/E3): gate único RBAC v2 — @Roles legado removido.
 * Anonimização é IRREVERSÍVEL: request/process restritos a DIRETOR+admins
 * (decisão Rafael, issue #623). G.GERAL (MANAGER legado) sai da LGPD.
 */
@Controller('lgpd')
export class LgpdController {
  constructor(private readonly lgpdService: LgpdService) {}

  // ─── Consentimento ────────────────────────────────────────────────────────

  @Post('consent')
  @RequirePermission('lgpd.consents.create')
  @ApiOperation({ summary: 'Registrar consentimento de titular' })
  registerConsent(@Body() dto: RegisterConsentDto, @CurrentUser() user: any) {
    return this.lgpdService.registerConsent(user.companyId, {
      ...dto,
      collectedBy: user.id,
    });
  }

  @Post('consent/:id/revoke')
  @RequirePermission('lgpd.consents.revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revogar consentimento' })
  revokeConsent(@Param('id') id: string, @CurrentUser() user: any) {
    return this.lgpdService.revokeConsent(id, user.companyId);
  }

  @Get('consent')
  @RequirePermission('lgpd.consents.view')
  @ApiOperation({ summary: 'Listar consentimentos' })
  @ApiQuery({ name: 'document', required: false })
  listConsents(@CurrentUser() user: any, @Query('document') document?: string) {
    return this.lgpdService.listConsents(user.companyId, document);
  }

  // ─── Portabilidade ────────────────────────────────────────────────────────

  @Get('data-subject/:document')
  @RequirePermission('lgpd.data-subjects.view')
  @ApiOperation({ summary: 'Exportar todos os dados de um titular (portabilidade LGPD)' })
  getDataSubject(@Param('document') document: string, @CurrentUser() user: any) {
    return this.lgpdService.getDataSubject(user.companyId, document);
  }

  // ─── Anonimização ────────────────────────────────────────────────────────

  @Post('anonymize/:document')
  @RequirePermission('lgpd.anonymization.request')
  @ApiOperation({ summary: 'Solicitar anonimização de dados pessoais (direito ao esquecimento)' })
  requestAnonymization(@Param('document') document: string, @CurrentUser() user: any) {
    return this.lgpdService.requestAnonymization(user.companyId, document, user.id);
  }

  @Post('anonymize/:requestId/process')
  @RequirePermission('lgpd.anonymization.process')
  @HttpCode(200)
  @ApiOperation({ summary: 'Processar anonimização solicitada' })
  processAnonymization(@Param('requestId') requestId: string, @CurrentUser() user: any) {
    return this.lgpdService.processAnonymization(requestId, user.companyId);
  }

  @Get('anonymization-requests')
  @RequirePermission('lgpd.anonymization.view')
  @ApiOperation({ summary: 'Listar requisições de anonimização' })
  listRequests(@CurrentUser() user: any) {
    return this.lgpdService.listAnonymizationRequests(user.companyId);
  }
}
