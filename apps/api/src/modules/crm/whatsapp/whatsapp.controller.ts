import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Queue } from 'bull';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WhatsappService } from './whatsapp.service';
import { WHATSAPP_QUEUE, WhatsappWebhookBody } from './whatsapp.types';

class SendWhatsappDto {
  @ApiPropertyOptional({ description: 'Texto livre da mensagem' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @ApiPropertyOptional({ description: 'URL pública de mídia' })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ enum: ['image', 'audio', 'document'] })
  @IsOptional()
  @IsIn(['image', 'audio', 'document'])
  mediaType?: 'image' | 'audio' | 'document';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  filename?: string;
}

@ApiTags('crm')
@Controller('crm/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly config: ConfigService,
    @InjectQueue(WHATSAPP_QUEUE) private readonly queue: Queue,
  ) {}

  /** Verificação do webhook (feita 1x pela Meta na configuração do app) */
  @Get('webhook')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Verificação do webhook WhatsApp (hub.challenge)' })
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ) {
    const expected = this.config.get<string>('WHATSAPP_VERIFY_TOKEN');
    if (!expected) throw new UnauthorizedException('WHATSAPP_VERIFY_TOKEN não configurado');
    if (mode !== 'subscribe' || token !== expected) {
      throw new UnauthorizedException('Verify token inválido');
    }
    return challenge;
  }

  /**
   * Recepção de eventos. Assinatura HMAC-SHA256 do corpo BRUTO com o app secret
   * (fail-closed, timingSafeEqual — mesmo padrão do webhook Focus). Responde 200
   * imediato e processa na fila (a Meta reenvia se demorarmos).
   */
  @Post('webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de mensagens/status da WhatsApp Cloud API' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: WhatsappWebhookBody,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const secret = this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!secret) {
      this.logger.warn('WHATSAPP_APP_SECRET não configurado — rejeitando webhook');
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

    await this.queue.add('inbound', { body }, { removeOnComplete: 500, removeOnFail: 100 });
    return { ok: true };
  }

  @Post('leads/:leadId/messages')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Enviar mensagem livre na conversa do lead (janela 24h)' })
  send(
    @Param('leadId') leadId: string,
    @Body() dto: SendWhatsappDto,
    @CurrentUser() user: any,
  ) {
    return this.whatsapp.send(user.companyId, leadId, dto, user.id);
  }

  @Get('leads/:leadId/messages')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mensagens da conversa do lead (inbox)' })
  @ApiQuery({ name: 'take', required: false })
  @ApiQuery({ name: 'before', required: false, description: 'ISO date — paginação p/ trás' })
  list(
    @Param('leadId') leadId: string,
    @CurrentUser() user: any,
    @Query('take') take?: string,
    @Query('before') before?: string,
  ) {
    return this.whatsapp.listMessages(
      user.companyId,
      leadId,
      take ? Math.min(parseInt(take, 10) || 50, 200) : 50,
      before,
    );
  }

  @Post('leads/:leadId/media')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Enviar mídia (foto/PDF/áudio) na conversa do lead' })
  sendMedia(
    @Param('leadId') leadId: string,
    @UploadedFile() file: any,
    @Body('caption') caption: string | undefined,
    @CurrentUser() user: any,
  ) {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    return this.whatsapp.sendUploadedMedia(user.companyId, leadId, file, caption, user.id);
  }

  @Get('media/:messageId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mídia da mensagem (proxy sob demanda na Meta)' })
  async media(
    @Param('messageId') messageId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const { data, mimeType } = await this.whatsapp.fetchMedia(user.companyId, messageId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  }
}
