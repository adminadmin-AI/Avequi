import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SessionRevokedReason } from '@prisma/client';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from '../../common/guards/local-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MfaService } from '../iam/mfa.service';
import { SessionService } from '../iam/session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Login com e-mail e senha' })
  async login(@Request() req: any) {
    // #342: IP + user-agent alimentam a UserSession criada no login.
    return this.authService.login(req.user, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Renovar access token com refresh token' })
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout — invalida refresh token e sessão (requer autenticação)' })
  async logout(@Body('refreshToken') refreshToken: string) {
    await this.authService.logout(refreshToken);
  }

  // ─── MFA/2FA TOTP (#344) ───────────────────────────────────────────────────

  @Public()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary:
      '2º passo do login MFA — troca mfaPendingToken (2min) + código TOTP/backup code pelos tokens finais',
  })
  async verifyMfa(
    @Request() req: any,
    @Body('mfaPendingToken') mfaPendingToken: string,
    @Body('code') code: string,
  ) {
    return this.authService.loginWithMfa(mfaPendingToken, code, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Iniciar setup de MFA — gera secret TOTP + otpauth:// URI (QR code no frontend)',
  })
  async setupMfa(@CurrentUser() user: any) {
    return this.mfaService.setup({ id: user.id, email: user.email });
  }

  @Post('mfa/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Confirmar setup com código TOTP → ativa o MFA e devolve os 10 backup codes (mostrados UMA vez)',
  })
  async confirmMfa(@CurrentUser() user: any, @Body('code') code: string) {
    return this.mfaService.confirm({ id: user.id, companyId: user.companyId }, code);
  }

  @Post('mfa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desabilitar MFA — exige senha + código TOTP/backup code válido' })
  async disableMfa(
    @CurrentUser() user: any,
    @Body('password') password: string,
    @Body('code') code: string,
  ) {
    await this.mfaService.disable({ id: user.id, companyId: user.companyId }, password, code);
  }

  @Post('mfa/backup-codes/regenerate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Regenerar os 10 backup codes (invalida os antigos) — exige código MFA válido',
  })
  async regenerateBackupCodes(@CurrentUser() user: any, @Body('code') code: string) {
    return this.mfaService.regenerateBackupCodes(
      { id: user.id, companyId: user.companyId },
      code,
    );
  }

  // ─── Sessões e dispositivos (#342) ─────────────────────────────────────────

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar minhas sessões ativas (base da tela "meus dispositivos")' })
  async listSessions(@CurrentUser() user: any) {
    return this.sessionService.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Revogar uma sessão específica (própria; SUPER_ADMIN revoga de qualquer usuário — entra na denylist)',
  })
  async revokeSession(@CurrentUser() user: any, @Param('id') id: string) {
    if (user.role === 'SUPER_ADMIN') {
      // Admin revoga sessão de qualquer usuário — revogação CRÍTICA:
      // além de matar o refresh, o sessionId entra na denylist Redis.
      await this.sessionService.revokeSession(id, SessionRevokedReason.ADMIN_REVOKE);
      return;
    }
    // Dono revoga a própria sessão (mismatch → 404, sem vazar existência).
    await this.sessionService.revokeSession(id, SessionRevokedReason.LOGOUT, user.id);
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout global — revoga todas as minhas sessões' })
  async revokeAllSessions(@CurrentUser() user: any) {
    await this.sessionService.revokeAllSessions(user.id, SessionRevokedReason.LOGOUT);
  }

  @Get('devices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar meus dispositivos conhecidos' })
  async listDevices(@CurrentUser() user: any) {
    return this.sessionService.listDevices(user.id);
  }

  @Post('devices/:id/trust')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marcar um dispositivo meu como confiável' })
  async trustDevice(@CurrentUser() user: any, @Param('id') id: string) {
    return this.sessionService.trustDevice(id, user.id, user.id);
  }
}
