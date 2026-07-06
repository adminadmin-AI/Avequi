import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginFailReason, SessionRevokedReason } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from '../iam/mfa.service';
import { LoginContext, SessionService } from '../iam/session.service';

/**
 * Claim `scope` do token intermediário do login em 2 passos (#344).
 * O JwtStrategy REJEITA tokens com este scope — o mfaPendingToken nunca
 * serve como access token; só é aceito por POST /auth/mfa/verify.
 */
export const MFA_PENDING_SCOPE = 'mfa_pending';
/** Vida do mfaPendingToken: 2 minutos (só o intervalo de digitar o código). */
export const MFA_PENDING_TOKEN_TTL = '2m';

/**
 * AuthService — login/refresh/logout com rotação de refresh token (SHA-256
 * no banco) e, desde a issue #342 (IAM v2 Fase M4), integrado ao
 * SessionService: login cria UserSession + registra LoginAttempt (lockout),
 * refresh mantém a MESMA sessão (só reamarra o novo refresh token), logout
 * revoga a sessão.
 *
 * COMPATIBILIDADE (Fase M4 da arquitetura): o payload do access token
 * continua { sub, email, role, companyId } e apenas GANHA o claim opcional
 * `sessionId`. Tokens antigos (sem o claim) e refresh tokens sem sessão
 * continuam aceitos até expirarem.
 *
 * FAILSAFE: sessão/attempt são best-effort dentro do SessionService — banco
 * de sessões indisponível não derruba o login (token sai sem sessionId).
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Valida credenciais com lockout e anti-enumeração (#342):
   * - conta trancada → 423 genérico (mesma resposta para e-mail inexistente
   *   trancado por tentativas — não revela se a conta existe);
   * - e-mail inexistente, senha errada e conta inativa devolvem TODOS null →
   *   o LocalStrategy responde o MESMO 401 "Credenciais inválidas";
   * - toda tentativa vira LoginAttempt; sucesso zera o lockout.
   */
  async validateUser(email: string, password: string, ctx: LoginContext = {}) {
    await this.sessionService.assertNotLocked(email, ctx);

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Mesmo motivo registrado para e-mail inexistente e senha errada —
      // nem a trilha interna cria assimetria explorável por timing/erro.
      await this.sessionService.recordLoginAttempt(
        email,
        ctx,
        false,
        LoginFailReason.WRONG_PASSWORD,
      );
      return null;
    }

    // #221: check isActive on login
    if (!user.isActive) {
      await this.sessionService.recordLoginAttempt(email, ctx, false, LoginFailReason.INACTIVE);
      return null;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await this.sessionService.recordLoginAttempt(
        email,
        ctx,
        false,
        LoginFailReason.WRONG_PASSWORD,
      );
      return null;
    }

    await this.sessionService.recordLoginAttempt(email, ctx, true);
    await this.sessionService.clearLockout(user.id);

    const { passwordHash: _ph, ...result } = user;
    return result;
  }

  /**
   * Login (1º passo). COMPATIBILIDADE TOTAL (#344): usuário SEM MFA
   * habilitado segue o fluxo de sempre — tokens finais direto (com o extra
   * opcional `mfaSetupRequired` quando um perfil dele exige MFA; enforcement
   * SUAVE — não bloqueia; o duro é decisão pendente do Rafael).
   *
   * Usuário COM MFA habilitado NÃO recebe tokens finais aqui: recebe um
   * mfaPendingToken de 2 min (claim scope=mfa_pending — rejeitado pelo
   * JwtStrategy como access token) e troca por tokens finais em
   * POST /auth/mfa/verify com o código TOTP/backup code. Nenhuma sessão nem
   * refresh token é criado antes do 2º passo.
   */
  async login(user: any, ctx: LoginContext = {}) {
    let mfaEnabled = false;
    try {
      mfaEnabled = await this.mfaService.isEnabled(user.id);
    } catch {
      // Best-effort: falha na consulta de MFA não pode derrubar o login de
      // quem nunca habilitou (failsafe do mesmo espírito do SessionService).
      mfaEnabled = false;
    }

    if (mfaEnabled) {
      const mfaPendingToken = this.jwtService.sign(
        { sub: user.id, scope: MFA_PENDING_SCOPE },
        { expiresIn: MFA_PENDING_TOKEN_TTL },
      );
      return { mfaRequired: true, mfaPendingToken };
    }

    const result = await this.issueTokens(user, ctx);
    // Enforcement suave por perfil (Role.requireMfa): sinaliza sem bloquear.
    const mfaSetupRequired = await this.mfaService.roleRequiresMfa(user.id);
    return mfaSetupRequired ? { ...result, mfaSetupRequired: true } : result;
  }

  /**
   * 2º passo do login MFA (#344): valida o mfaPendingToken + código TOTP ou
   * backup code → só então emite os tokens finais e cria a sessão.
   * Código errado → LoginAttempt(fail, MFA_FAILED) (conta para o lockout) +
   * SecurityEvent + 401.
   */
  async loginWithMfa(mfaPendingToken: string, code: string, ctx: LoginContext = {}) {
    let payload: any;
    try {
      payload = this.jwtService.verify(mfaPendingToken);
    } catch {
      throw new UnauthorizedException('Token MFA inválido ou expirado. Faça login novamente.');
    }
    if (payload?.scope !== MFA_PENDING_SCOPE || !payload?.sub) {
      // Access/refresh token no lugar do pending token → rejeita.
      throw new UnauthorizedException('Token MFA inválido ou expirado. Faça login novamente.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Token MFA inválido ou expirado. Faça login novamente.');
    }

    // Lockout também protege o 2º passo (brute-force de TOTP além do throttle).
    await this.sessionService.assertNotLocked(user.email, ctx);

    const valid = await this.mfaService.verifyCode(user.id, code);
    if (!valid) {
      await this.sessionService.recordLoginAttempt(
        user.email,
        ctx,
        false,
        LoginFailReason.MFA_FAILED,
      );
      await this.mfaService.recordFailedVerify(
        { id: user.id, companyId: user.companyId },
        ctx,
      );
      throw new UnauthorizedException('Código MFA inválido.');
    }

    await this.sessionService.recordLoginAttempt(user.email, ctx, true);
    await this.sessionService.clearLockout(user.id);

    const { passwordHash: _ph, ...safeUser } = user;
    return this.issueTokens(safeUser, ctx);
  }

  /**
   * Emissão dos tokens finais: par access+refresh, refresh persistido (hash
   * SHA-256) e UserSession vinculada (#342). O access token ganha o claim
   * `sessionId` quando a sessão foi criada; se a criação falhar
   * (best-effort), o token sai sem o claim — tratado como legado.
   */
  private async issueTokens(user: any, ctx: LoginContext = {}) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    };

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRY ?? '7d',
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // #221: store hashed refresh token
    const stored = await this.prisma.refreshToken.create({
      data: {
        token: this.hashToken(refreshToken),
        userId: user.id,
        expiresAt,
      },
    });

    // #342: sessão amarrada ao refresh token (Decisão 4 — híbrido).
    const session = await this.sessionService.createSession(
      { id: user.id, companyId: user.companyId },
      ctx,
      stored.id,
    );

    const accessToken = this.jwtService.sign(
      session ? { ...payload, sessionId: session.id } : payload,
    );

    return { accessToken, refreshToken, user };
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    // #221: check isActive on refresh
    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { isActive: true },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException('Usuário desativado');
    }

    // #342: sessão vinculada ainda ativa? (revogada/inativa 60min+ → 401).
    // Refresh sem sessão (emitido antes da M4) continua aceito.
    const sessionCheck = await this.sessionService.validateSessionForRefresh(stored.id);
    if (!sessionCheck.active) {
      throw new UnauthorizedException('Sessão encerrada. Faça login novamente.');
    }

    // Rotate: revoke old, issue new
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { iat, exp, sessionId: _prevSessionId, ...rest } = payload;
    const accessPayload = sessionCheck.session
      ? { ...rest, sessionId: sessionCheck.session.id }
      : rest;
    const newAccessToken = this.jwtService.sign(accessPayload);
    const newRefreshToken = this.jwtService.sign(rest, {
      secret: process.env.JWT_REFRESH_SECRET,
      expiresIn: process.env.JWT_REFRESH_EXPIRY ?? '7d',
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const newStored = await this.prisma.refreshToken.create({
      data: {
        token: this.hashToken(newRefreshToken),
        userId: stored.userId,
        expiresAt,
      },
    });

    // #342: a rotação mantém a MESMA sessão — só reamarra o novo token.
    if (sessionCheck.session) {
      await this.sessionService.attachRefreshToSession(sessionCheck.session.id, newStored.id);
    }

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshToken: string) {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
    });
    if (!stored || stored.revokedAt) return;
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    // #342: logout encerra a sessão vinculada (best-effort).
    await this.sessionService.revokeSessionByRefreshTokenId(
      stored.id,
      SessionRevokedReason.LOGOUT,
    );
  }
}
