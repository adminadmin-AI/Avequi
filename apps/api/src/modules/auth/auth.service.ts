import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  LoginFailReason,
  SecurityEventSeverity,
  SecurityEventType,
  SessionRevokedReason,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaService } from '../iam/mfa.service';
import { PasswordPolicyService } from '../iam/password-policy.service';
import { LoginContext, SessionService } from '../iam/session.service';
import { TenantStatusService } from '../iam/tenant-status.service';

/**
 * Claim `scope` do token intermediário do login em 2 passos (#344).
 * O JwtStrategy REJEITA tokens com este scope — o mfaPendingToken nunca
 * serve como access token; só é aceito por POST /auth/mfa/verify.
 */
export const MFA_PENDING_SCOPE = 'mfa_pending';
/** Vida do mfaPendingToken: 2 minutos (só o intervalo de digitar o código). */
export const MFA_PENDING_TOKEN_TTL = '2m';

/**
 * Claim `scope` do token restrito de troca de senha (#345) — mesmo padrão do
 * mfaPendingToken (#344): vida curta, REJEITADO pelo JwtStrategy como access
 * token, aceito SOMENTE por POST /auth/change-password. Emitido no login
 * quando a senha venceu (rotação por perfil) ou mustChangePassword=true
 * (primeiro acesso / reset por admin).
 */
export const PASSWORD_CHANGE_SCOPE = 'password_change';
/** Vida do passwordChangeToken: 10 minutos (tempo de escolher a senha nova). */
export const PASSWORD_CHANGE_TOKEN_TTL = '10m';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly mfaService: MfaService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly tenantStatus: TenantStatusService,
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

    // OPS WP1 (#908): tenant SUSPENDED/CHURNED não autentica. O check vem
    // DEPOIS da senha de propósito — só quem provou a credencial vê a
    // mensagem de regularização (403); antes disso a resposta continua o
    // 401 genérico da anti-enumeração (#342).
    const tenantBlock = await this.tenantStatus.getLoginBlock(user.companyId);
    if (tenantBlock) {
      await this.sessionService.recordLoginAttempt(
        email,
        ctx,
        false,
        LoginFailReason.TENANT_SUSPENDED,
      );
      throw new ForbiddenException(tenantBlock.message);
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

    // #345: senha vencida (rotação por perfil) ou troca obrigatória
    // (primeiro acesso / reset por admin) → NÃO emite tokens finais; devolve
    // token restrito de troca de senha (scope=password_change).
    const gate = await this.passwordGate(user);
    if (gate) return gate;

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

    // #345: gate de senha DEPOIS do MFA — não vaza estado de senha antes do
    // segundo fator; senha vencida/troca obrigatória → token restrito.
    const gate = await this.passwordGate(safeUser);
    if (gate) return gate;

    return this.issueTokens(safeUser, ctx);
  }

  /**
   * Gate de política de senha no login (#345). Retorna null quando a senha
   * está OK; caso contrário devolve a resposta restrita do login:
   * `passwordExpired` (rotação por perfil vencida) e/ou `mustChangePassword`
   * (primeiro acesso / reset por admin) + `passwordChangeToken` de 10 min
   * aceito só por POST /auth/change-password. Best-effort na consulta de
   * rotação: indisponibilidade nunca derruba o login.
   */
  private async passwordGate(user: {
    id: string;
    mustChangePassword?: boolean;
    passwordChangedAt?: Date | null;
    createdAt?: Date | null;
  }) {
    const mustChange = user.mustChangePassword === true;
    let expired = false;
    if (!mustChange) {
      try {
        expired = await this.passwordPolicy.isPasswordExpired(user);
      } catch {
        expired = false;
      }
    }
    if (!mustChange && !expired) return null;

    const passwordChangeToken = this.jwtService.sign(
      { sub: user.id, scope: PASSWORD_CHANGE_SCOPE },
      { expiresIn: PASSWORD_CHANGE_TOKEN_TTL },
    );
    return {
      passwordChangeRequired: true,
      passwordExpired: expired,
      mustChangePassword: mustChange,
      passwordChangeToken,
    };
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
      select: { isActive: true, mustChangePassword: true, companyId: true },
    });
    if (!user?.isActive) {
      throw new UnauthorizedException('Usuário desativado');
    }

    // OPS WP1 (#908): defesa em profundidade — a suspensão do tenant já
    // revoga as sessões (OpsService), mas um refresh legado sem sessão
    // escaparia da denylist; aqui ele morre de vez.
    const tenantBlock = await this.tenantStatus.getLoginBlock(user.companyId);
    if (tenantBlock) {
      throw new ForbiddenException(tenantBlock.message);
    }

    // #750 (defesa em profundidade): troca obrigatória pendente = refresh
    // NEGADO. O reset por admin já revoga as sessões do alvo; este bloqueio
    // garante que uma sessão que tenha escapado (falha parcial da revogação,
    // refresh legado sem sessão) não continue renovando tokens. Revoga o
    // refresh apresentado e as sessões restantes (SECURITY → denylist) e
    // exige novo login — que devolve o token restrito da tela de troca
    // (#743). O fluxo do token restrito não passa por aqui.
    if (user.mustChangePassword) {
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      try {
        await this.sessionService.revokeAllSessions(
          stored.userId,
          SessionRevokedReason.SECURITY,
        );
      } catch (err) {
        this.logger.warn(
          `Falha ao revogar sessões no refresh com troca pendente (best-effort): ${(err as Error).message}`,
        );
      }
      throw new UnauthorizedException(
        'Troca de senha obrigatória. Faça login novamente.',
      );
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

  // ─── Troca de senha (#345 — IAM v2 F4.2) ───────────────────────────────────

  /**
   * POST /auth/change-password. Dois modos de autenticação:
   *
   * 1. NORMAL: Bearer access token no header → exige `currentPassword`
   *    (bcrypt compare) — mesmo logado, trocar senha reconfirma identidade.
   * 2. RESTRITO: `passwordChangeToken` (scope=password_change, 10 min) no
   *    body — emitido pelo login quando a senha venceu ou
   *    mustChangePassword=true. NÃO exige currentPassword: o usuário acabou
   *    de prová-la no login.
   *
   * Sempre: valida complexidade + histórico (reuso das últimas 5),
   * atualiza passwordChangedAt, zera mustChangePassword, registra
   * gdr_password_history, revoga TODAS as OUTRAS sessões (a atual sobrevive
   * no modo normal) e grava SecurityEvent PASSWORD_CHANGED.
   */
  async changePassword(input: {
    authorizationHeader?: string;
    passwordChangeToken?: string;
    currentPassword?: string;
    newPassword: string;
  }) {
    const { userId, sessionId, restricted, tokenIssuedAt } =
      this.resolveChangePasswordIdentity(input);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Sessão inválida. Faça login novamente.');
    }

    // Anti-replay do token restrito: o JWT é stateless, então um token
    // capturado valeria pelos 10 min inteiros MESMO depois de a senha já ter
    // sido trocada — permitindo uma segunda troca por cima da senha que o
    // usuário acabou de definir. Token emitido ANTES da última troca
    // (iat < passwordChangedAt) é rejeitado: cada troca invalida todos os
    // tokens restritos anteriores. (iat vem em segundos; passwordChangedAt
    // em ms — trunca o timestamp da troca para segundos p/ comparar justo.)
    if (restricted && user.passwordChangedAt && tokenIssuedAt != null) {
      const changedAtSeconds = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (tokenIssuedAt < changedAtSeconds) {
        throw new UnauthorizedException(
          'Token de troca de senha inválido ou expirado. Faça login novamente.',
        );
      }
    }

    if (!restricted) {
      // Modo normal: reconfirma a senha atual.
      if (!input.currentPassword) {
        throw new UnauthorizedException('Informe a senha atual.');
      }
      const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!valid) {
        throw new UnauthorizedException('Senha atual incorreta.');
      }
    }

    // Política de complexidade (mensagens PT-BR do que faltou) + histórico.
    this.passwordPolicy.validateComplexity(input.newPassword, {
      email: user.email,
      name: user.name,
    });
    await this.passwordPolicy.assertNotReused(user.id, input.newPassword);

    const newHash = await bcrypt.hash(input.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newHash,
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Histórico (inclui o hash ANTERIOR na primeira troca) — best-effort.
    await this.passwordPolicy.recordPasswordChange(user.id, user.passwordHash, newHash);

    // Revoga TODAS as OUTRAS sessões (reason SECURITY → denylist: access
    // tokens das outras sessões morrem imediatamente, não só o refresh).
    try {
      await this.sessionService.revokeAllSessions(
        user.id,
        SessionRevokedReason.SECURITY,
        sessionId,
      );
    } catch (err) {
      this.logger.warn(
        `Falha ao revogar sessões após troca de senha (best-effort): ${(err as Error).message}`,
      );
    }

    // SecurityEvent PASSWORD_CHANGED (best-effort — nunca desfaz a troca).
    try {
      await this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          eventType: SecurityEventType.PASSWORD_CHANGED,
          severity: SecurityEventSeverity.INFO,
          metadata: { restricted, otherSessionsRevoked: true },
        },
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao gravar SecurityEvent PASSWORD_CHANGED (best-effort): ${(err as Error).message}`,
      );
    }

    return { success: true, message: 'Senha alterada com sucesso.' };
  }

  /**
   * Resolve QUEM está trocando a senha: token restrito (body) OU access
   * token normal (header). Token restrito no header e access token no body
   * são ambos rejeitados — cada credencial só vale no seu canal.
   */
  private resolveChangePasswordIdentity(input: {
    authorizationHeader?: string;
    passwordChangeToken?: string;
  }): { userId: string; sessionId?: string; restricted: boolean; tokenIssuedAt?: number } {
    if (input.passwordChangeToken) {
      let payload: any;
      try {
        payload = this.jwtService.verify(input.passwordChangeToken);
      } catch {
        throw new UnauthorizedException(
          'Token de troca de senha inválido ou expirado. Faça login novamente.',
        );
      }
      if (payload?.scope !== PASSWORD_CHANGE_SCOPE || !payload?.sub) {
        throw new UnauthorizedException(
          'Token de troca de senha inválido ou expirado. Faça login novamente.',
        );
      }
      return { userId: payload.sub, restricted: true, tokenIssuedAt: payload.iat };
    }

    const header = input.authorizationHeader ?? '';
    if (header.startsWith('Bearer ')) {
      const token = header.slice('Bearer '.length).trim();
      let payload: any;
      try {
        payload = this.jwtService.verify(token);
      } catch {
        throw new UnauthorizedException('Não autenticado. Faça login para trocar a senha.');
      }
      // Tokens restritos (mfa_pending, password_change) NÃO valem como
      // access token — mesmo comportamento do JwtStrategy.
      if (payload?.scope || !payload?.sub) {
        throw new UnauthorizedException('Não autenticado. Faça login para trocar a senha.');
      }
      return { userId: payload.sub, sessionId: payload.sessionId, restricted: false };
    }

    throw new UnauthorizedException('Não autenticado. Faça login para trocar a senha.');
  }
}
