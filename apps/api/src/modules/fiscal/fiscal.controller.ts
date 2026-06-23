import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { FiscalService } from './fiscal.service';

@ApiTags('Fiscal')
@ApiBearerAuth()
@Controller('fiscal')
export class FiscalController {
  private readonly logger = new Logger(FiscalController.name);

  constructor(
    private readonly fiscalService: FiscalService,
    private readonly config: ConfigService,
  ) {}

  /** S08.04 — Webhook da Focus NFe (autenticado por secret no header) */
  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de retorno assíncrono da Focus NFe' })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-focus-token') focusToken?: string,
  ) {
    const secret = this.config.get<string>('FOCUS_NFE_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('FOCUS_NFE_WEBHOOK_SECRET not configured — rejecting webhook');
      throw new UnauthorizedException('Webhook secret not configured');
    }
    if (!focusToken) {
      throw new UnauthorizedException('Missing webhook token');
    }
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(focusToken, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid webhook token');
    }

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
