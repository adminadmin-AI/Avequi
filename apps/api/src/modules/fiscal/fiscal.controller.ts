import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { FiscalService } from './fiscal.service';

@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscalService: FiscalService) {}

  /** S08.04 — Webhook da Focus NFe (sem autenticação JWT — autenticado por secret no header) */
  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de retorno assíncrono da Focus NFe' })
  async webhook(@Body() body: Record<string, unknown>) {
    await this.fiscalService.handleWebhook(body);
    return { ok: true };
  }

  /** S08.05 — Reprocessar documento rejeitado ou em erro */
  @Post(':id/retry')
  @ApiOperation({ summary: 'Reprocessar documento fiscal rejeitado' })
  async retry(@Param('id') id: string, @CurrentUser() user: any) {
    await this.fiscalService.retry(id, user.companyId);
    return { ok: true };
  }

  @Get()
  @ApiOperation({ summary: 'Listar documentos fiscais da empresa' })
  findAll(@CurrentUser() user: any) {
    return this.fiscalService.findAll(user.companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do documento fiscal' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.fiscalService.findOne(id, user.companyId);
  }
}
