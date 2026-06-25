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
import { LgpdService } from './lgpd.service';
import { RegisterConsentDto } from './dto/register-consent.dto';

@ApiTags('LGPD')
@ApiBearerAuth()
@Controller('lgpd')
export class LgpdController {
  constructor(private readonly lgpdService: LgpdService) {}

  // ─── Consentimento ────────────────────────────────────────────────────────

  @Post('consent')
  @ApiOperation({ summary: 'Registrar consentimento de titular' })
  registerConsent(@Body() dto: RegisterConsentDto, @CurrentUser() user: any) {
    return this.lgpdService.registerConsent(user.companyId, {
      ...dto,
      collectedBy: user.id,
    });
  }

  @Post('consent/:id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revogar consentimento' })
  revokeConsent(@Param('id') id: string, @CurrentUser() user: any) {
    return this.lgpdService.revokeConsent(id, user.companyId);
  }

  @Get('consent')
  @ApiOperation({ summary: 'Listar consentimentos' })
  @ApiQuery({ name: 'document', required: false })
  listConsents(@CurrentUser() user: any, @Query('document') document?: string) {
    return this.lgpdService.listConsents(user.companyId, document);
  }

  // ─── Portabilidade ────────────────────────────────────────────────────────

  @Get('data-subject/:document')
  @ApiOperation({ summary: 'Exportar todos os dados de um titular (portabilidade LGPD)' })
  getDataSubject(@Param('document') document: string, @CurrentUser() user: any) {
    return this.lgpdService.getDataSubject(user.companyId, document);
  }

  // ─── Anonimização ────────────────────────────────────────────────────────

  @Post('anonymize/:document')
  @ApiOperation({ summary: 'Solicitar anonimização de dados pessoais (direito ao esquecimento)' })
  requestAnonymization(@Param('document') document: string, @CurrentUser() user: any) {
    return this.lgpdService.requestAnonymization(user.companyId, document, user.id);
  }

  @Post('anonymize/:requestId/process')
  @HttpCode(200)
  @ApiOperation({ summary: 'Processar anonimização solicitada' })
  processAnonymization(@Param('requestId') requestId: string, @CurrentUser() user: any) {
    return this.lgpdService.processAnonymization(requestId, user.companyId);
  }

  @Get('anonymization-requests')
  @ApiOperation({ summary: 'Listar requisições de anonimização' })
  listRequests(@CurrentUser() user: any) {
    return this.lgpdService.listAnonymizationRequests(user.companyId);
  }
}
