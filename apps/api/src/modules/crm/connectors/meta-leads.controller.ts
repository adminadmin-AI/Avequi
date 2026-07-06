import { InjectQueue } from '@nestjs/bull';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Queue } from 'bull';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { CRM_LEADS_QUEUE } from './connectors.types';

/**
 * F1.4 (#510) — webhook leadgen do Meta Lead Ads. Mesmo app/assinatura do
 * WhatsApp (X-Hub-Signature-256, HMAC do corpo bruto, fail-closed) — com
 * overrides META_APP_SECRET/META_VERIFY_TOKEN caso sejam apps separados.
 */
@ApiTags('crm')
@Controller('crm/meta')
export class MetaLeadsController {
  private readonly logger = new Logger(MetaLeadsController.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(CRM_LEADS_QUEUE) private readonly queue: Queue,
  ) {}

  private secret(): string | undefined {
    return this.config.get<string>('META_APP_SECRET') ?? this.config.get<string>('WHATSAPP_APP_SECRET');
  }

  private verifyToken(): string | undefined {
    return (
      this.config.get<string>('META_VERIFY_TOKEN') ?? this.config.get<string>('WHATSAPP_VERIFY_TOKEN')
    );
  }

  @Get('webhook')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Verificação do webhook leadgen (hub.challenge)' })
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const expected = this.verifyToken();
    if (!expected) throw new UnauthorizedException('Verify token não configurado');
    if (mode !== 'subscribe' || token !== expected) {
      throw new UnauthorizedException('Verify token inválido');
    }
    return challenge;
  }

  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook leadgen do Meta Lead Ads' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const secret = this.secret();
    if (!secret) {
      this.logger.warn('META_APP_SECRET/WHATSAPP_APP_SECRET ausentes — rejeitando webhook');
      throw new UnauthorizedException('Webhook secret não configurado');
    }
    if (!signature?.startsWith('sha256=') || !req.rawBody) {
      throw new UnauthorizedException('Assinatura ausente');
    }
    const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature.slice('sha256='.length), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        if (change?.field === 'leadgen' && change?.value) {
          await this.queue.add('meta-lead', { value: change.value }, {
            removeOnComplete: 500,
            removeOnFail: 200,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
          });
        }
      }
    }
    return { ok: true };
  }
}
