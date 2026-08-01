import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SessionRevokedReason } from '@prisma/client';
import { Response } from 'express';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from '../../common/auth/auth-cookies';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from '../../common/guards/local-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { PermissionService } from '../iam/permission.service';
import { SessionService } from '../iam/session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly permissionService: PermissionService,
  ) {}

  @Public()
  @UseGuards(LocalAuthGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Login com e-mail e senha' })
  async login(@Request() req: any, @Res({ passthrough: true }) res: Response) {
    // #342: IP + user-agent alimentam a UserSession criada no login.
    const result = await this.authService.login(req.user, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    // #349: emissão de tokens também vira cookies httpOnly (modo dual — o
    // body continua com os tokens p/ clientes Bearer). MFA pendente não
    // emite tokens, logo não seta cookies.
    if ('accessToken' in result) {
      const csrfToken = setAuthCookies(res, result);
      return { ...result, csrfToken };
    }
    return result;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Renovar access token com refresh token' })
  async refresh(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
    @Body('refreshToken') refreshToken?: string,
  ) {
    // #349: body tem precedência (clientes Bearer atuais); sem body, usa o
    // cookie httpOnly gdr_refresh (front migrado). Rotação normal nos dois.
    const token = refreshToken || req.cookies?.[REFRESH_COOKIE];
    const result = await this.authService.refresh(token);
    const csrfToken = setAuthCookies(res, result);
    return { ...result, csrfToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout — invalida refresh token e sessão (requer autenticação)' })
  async logout(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
    @Body('refreshToken') refreshToken?: string,
  ) {
    await this.authService.logout(refreshToken || req.cookies?.[REFRESH_COOKIE]);
    // #349: sessão de cookie morre junto, sempre.
    clearAuthCookies(res);
  }

  // ─── Minhas permissões (#351) ──────────────────────────────────────────────

  /**
   * Permissões EFETIVAS do usuário logado — consumido pelo frontend
   * (usePermission()/<Can>) para esconder o que o usuário não pode fazer.
   *
   * Rota autenticada normal, SEM @Roles: todo usuário pode (e deve) ver as
   * próprias permissões. userId, companyId e role vêm SEMPRE do JWT — a rota
   * NÃO aceita alvo por query/body (é "meu contexto de sessão").
   *
   * Fallback legado: usuário sem nada no RBAC v2 recebe as permissões do
   * perfil-espelho do seu enum `User.role` (ver
   * PermissionService.getMyEffectivePermissions) — nunca fica sem nada.
   *
   * Regra de ouro: isto é UX, não segurança. O enforcement real continua no
   * backend (PermissionGuard/@RequirePermission).
   */
  @Get('me/permissions')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Permissões efetivas do usuário logado (RBAC v2 + fallback do enum legado) — usado pelo frontend',
  })
  async myPermissions(@CurrentUser() user: any) {
    return this.permissionService.getMyEffectivePermissions(
      user.id,
      user.companyId,
      user.role,
    );
  }

  // ─── Password policy (#345) ────────────────────────────────────────────────

  @Public()
  @Get('password-policy')
  @ApiOperation({ summary: 'Política de senha vigente (regras de complexidade e histórico)' })
  passwordPolicyInfo() {
    return this.passwordPolicy.getPolicy();
  }

  /**
   * @Public + resolução manual de identidade no service: o endpoint aceita
   * DUAS credenciais — access token normal (header Authorization, exige
   * currentPassword) OU passwordChangeToken restrito no body (emitido pelo
   * login quando a senha venceu / mustChangePassword). O guard global de JWT
   * rejeitaria o token restrito, por isso a rota é pública e a autenticação
   * é feita explicitamente dentro do AuthService.changePassword.
   */
  @Public()
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({
    summary:
      'Trocar senha — autenticado (Bearer + senha atual) OU com passwordChangeToken restrito do login (senha vencida/troca obrigatória)',
  })
  async changePassword(
    @Request() req: any,
    @Body('currentPassword') currentPassword: string,
    @Body('newPassword') newPassword: string,
    @Body('passwordChangeToken') passwordChangeToken: string,
  ) {
    return this.authService.changePassword({
      authorizationHeader: req.headers?.authorization,
      passwordChangeToken,
      currentPassword,
      newPassword,
    });
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
    @Res({ passthrough: true }) res: Response,
    @Body('mfaPendingToken') mfaPendingToken: string,
    @Body('code') code: string,
  ) {
    const result = await this.authService.loginWithMfa(mfaPendingToken, code, {
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    // #349: 2º passo emite os tokens finais → mesmos cookies do login.
    if ('accessToken' in result) {
      const csrfToken = setAuthCookies(res, result);
      return { ...result, csrfToken };
    }
    return result;
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
