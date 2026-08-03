import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { TenantInviteService } from './tenant-invite.service';

/**
 * InviteController — OPS WP2 (#909): aceite PÚBLICO do convite de primeiro
 * acesso do admin do tenant.
 *
 * Controller SEPARADO do OpsController de propósito: o OpsMfaGuard do /ops
 * não respeita @Public (by design — lá ninguém entra sem MFA), e o aceite
 * acontece ANTES de o usuário ter qualquer credencial. Mesmo padrão de
 * proteção do login (#342): @Public + throttle apertado + resposta única
 * para token inválido/expirado/usado (não revela qual).
 */
@ApiTags('invite')
@Controller('invite')
export class InviteController {
  constructor(private readonly inviteService: TenantInviteService) {}

  @Public()
  @Post('accept')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Aceita o convite de primeiro acesso: valida o token (uso único, 72h) ' +
      'e define a senha do admin do tenant (política #345).',
  })
  accept(@Body() dto: AcceptInviteDto) {
    return this.inviteService.acceptInvite(dto.token, dto.password);
  }
}
