import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LoginFailReason, SessionRevokedReason } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginContext, SessionService } from '../iam/session.service';

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
   * Login: emite par de tokens, persiste o refresh (hash SHA-256) e cria a
   * UserSession vinculada (#342). O access token ganha o claim `sessionId`
   * quando a sessão foi criada; se a criação falhar (best-effort), o token
   * sai sem o claim — tratado como legado.
   */
  async login(user: any, ctx: LoginContext = {}) {
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

    // #342: sessão vinculada ainda ativa? (revogada/inativa 8h+ → 401).
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
