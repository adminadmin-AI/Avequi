import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PushService } from './push.service';

class PushKeysDto {
  @ApiProperty({ description: 'Chave pública ECDH do navegador (base64url)' })
  @IsString()
  p256dh: string;

  @ApiProperty({ description: 'Auth secret do navegador (base64url)' })
  @IsString()
  auth: string;
}

class SubscribeDto {
  @ApiProperty({ description: 'URL única do push service do navegador' })
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  endpoint: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @ApiPropertyOptional({ description: 'User agent do dispositivo (exibido na config)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

class UnsubscribeDto {
  @ApiProperty({ description: 'Endpoint da assinatura a remover' })
  @IsUrl({ require_protocol: true })
  @MaxLength(1000)
  endpoint: string;
}

/** CRM V2.1 (#568) — opt-in/opt-out de web push por dispositivo do usuário logado */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly push: PushService) {}

  @Get('push/public-key')
  @ApiOperation({ summary: 'Chave pública VAPID (null = push desativado no servidor)' })
  getPublicKey() {
    return this.push.getPublicKey();
  }

  @Get('push/subscriptions')
  @ApiOperation({ summary: 'Assinaturas de push do usuário logado' })
  listMine(@CurrentUser() user: { id: string }) {
    return this.push.listMine(user.id);
  }

  @Post('push/subscribe')
  @ApiOperation({ summary: 'Registra a assinatura de push deste dispositivo' })
  subscribe(@CurrentUser() user: { id: string }, @Body() dto: SubscribeDto) {
    return this.push.subscribe(user.id, dto);
  }

  @Delete('push/subscribe')
  @ApiOperation({ summary: 'Remove a assinatura de push deste dispositivo (opt-out)' })
  unsubscribe(@CurrentUser() user: { id: string }, @Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(user.id, dto.endpoint);
  }
}
