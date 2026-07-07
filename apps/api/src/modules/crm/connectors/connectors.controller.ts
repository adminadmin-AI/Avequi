import { InjectQueue } from '@nestjs/bull';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { LeadSource } from '@prisma/client';
import { Queue } from 'bull';
import { timingSafeEqual } from 'crypto';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { LeadIntakeService } from '../lead-intake.service';
import { CRM_LEADS_QUEUE } from './connectors.types';
import { StoreResolver } from './connectors.util';
import { MercadoLivreService } from './mercadolivre.service';

class OlxLeadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @ApiPropertyOptional({ description: 'Título/link do anúncio' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  listing?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  store?: string;

  @ApiPropertyOptional({ description: 'Ref única da origem (id do lead OLX / message-id do e-mail)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;
}

class AnswerMlDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  text: string;
}

/**
 * F1.5 (#511) — Mercado Livre (webhook + resposta) e OLX (hook genérico).
 * OLX não tem API pública estável → endpoint autenticado por secret que uma
 * automação (parser do e-mail de notificação / plano pro) chama.
 */
@ApiTags('crm')
@Controller('crm')
export class ConnectorsController {
  private readonly logger = new Logger(ConnectorsController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly leadIntake: LeadIntakeService,
    private readonly storeResolver: StoreResolver,
    private readonly ml: MercadoLivreService,
    @InjectQueue(CRM_LEADS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Notificações do ML (perguntas). ML não assina — validamos o application_id. */
  @Post('mercadolivre/webhook')
  @Public()
  @SkipThrottle()
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de notificações do Mercado Livre (questions)' })
  async mlWebhook(@Body() body: { topic?: string; resource?: string; application_id?: number | string }) {
    const expectedApp = this.config.get<string>('ML_CLIENT_ID');
    if (!expectedApp || String(body?.application_id ?? '') !== expectedApp) {
      // sem client id configurado ou app diferente → não é nosso
      throw new UnauthorizedException('application_id inválido');
    }
    if (body.topic === 'questions' && body.resource) {
      await this.queue.add(
        'ml-question',
        { resource: body.resource },
        { removeOnComplete: 500, removeOnFail: 200, attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
      );
    }
    return { ok: true };
  }

  /** Responder pergunta do ML de dentro do inbox */
  @Post('leads/:leadId/ml-answer/:questionId')
  @ApiBearerAuth()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL', 'STORE')
  @ApiOperation({ summary: 'Responder pergunta do Mercado Livre pelo ERP' })
  answerMl(
    @Param('leadId') leadId: string,
    @Param('questionId') questionId: string,
    @Body() dto: AnswerMlDto,
    @CurrentUser() user: any,
  ) {
    return this.ml.answerQuestion(user.companyId, leadId, questionId, dto.text, user.id);
  }

  /** Hook OLX: secret no header (automação do e-mail de notificação / API pro) */
  @Post('olx/lead')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(202)
  @ApiOperation({ summary: 'Entrada de lead OLX via automação (x-olx-token)' })
  async olxLead(@Body() dto: OlxLeadDto, @Headers('x-olx-token') token?: string) {
    const secret = this.config.get<string>('OLX_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('OLX_WEBHOOK_SECRET não configurado — rejeitando (fail-closed)');
      throw new UnauthorizedException('OLX hook não configurado');
    }
    const a = Buffer.from(secret, 'utf8');
    const b = Buffer.from(token ?? '', 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token inválido');
    }

    const companyId = await this.storeResolver.resolve(dto.store);
    await this.leadIntake.intake(companyId, {
      name: dto.name,
      phone: dto.phone,
      email: dto.email,
      source: LeadSource.OLX,
      externalRef: dto.externalRef,
      interest: dto.listing,
      sourceMeta: { listing: dto.listing ?? null, store: dto.store ?? null },
    });
    return { ok: true };
  }
}
