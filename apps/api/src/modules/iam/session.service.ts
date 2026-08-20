import { HttpException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import {
  LoginFailReason,
  SecurityEventSeverity,
  SecurityEventType,
  SessionRevokedReason,
  TrustedDevice,
  UserSession,
} from '@prisma/client';
import { AuditAction } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { SessionDenylistService } from './session-denylist.service';

/**
 * SessionService — issue #342 (Fase F3.3/M4 do IAM v2).
 *
 * Implementa o Bloco B da arquitetura (docs/iam/ARQUITETURA-IAM-V2.md):
 * sessões, dispositivos e lockout, amarrados ao token híbrido da Decisão 4.
 *
 * ── Sessões ──────────────────────────────────────────────────────────────
 * Cada login cria uma UserSession (IP, user-agent, fingerprint) vinculada ao
 * RefreshToken vigente. A rotação de refresh MANTÉM a mesma sessão (só troca
 * o refreshTokenId). Revogar a sessão mata o refresh → o usuário cai em no
 * máximo 15 min (vida do access token) ou IMEDIATAMENTE quando a revogação é
 * crítica (denylist Redis consultada pela JwtStrategy em toda request
 * autenticada — #823; Redis indisponível = fail-open, o token expira
 * naturalmente e o refresh segue bloqueado pelos mecanismos persistentes).
 * Limite de sessões simultâneas: 5 (a mais antiga é derrubada).
 *
 * ── Lockout (usa BANCO, nunca Redis — segurança não pode ser best-effort) ─
 * Toda tentativa vira LoginAttempt (sem FK de propósito: registra também
 * e-mails inexistentes). Política: 5 falhas consecutivas dentro de 15 min →
 * trava com escala progressiva 30min → 1h → 2h → 4h → 24h (a cada novo bloco
 * de 5 falhas sobe um degrau). Para usuários reais a trava persiste em
 * User.lockedUntil; para e-mails INEXISTENTES a trava é derivada dos próprios
 * LoginAttempt — assim a resposta 423 é IDÊNTICA para conta real e conta
 * inventada (anti-enumeração). Sucesso zera o contador (streak quebra) e
 * limpa lockedUntil. Lockout NÃO revoga sessões existentes: falha de senha é
 * frequentemente um ATAQUE contra o dono legítimo — derrubar a sessão dele
 * seria transformar brute-force em DoS.
 *
 * ── Failsafe ─────────────────────────────────────────────────────────────
 * Sessão/dispositivo/attempt são best-effort: banco indisponível NUNCA
 * derruba o login (o access token sai sem o claim sessionId — tratado como
 * legado, ver Fase M4 da arquitetura). A ÚNICA exceção deliberada é o
 * assertNotLocked: se a consulta de lockout falhar, loga e deixa passar
 * (fail-open documentado — Fase M4: "lockout entra com limites frouxos").
 */

/** Contexto da requisição de login (IP + user-agent). */
export interface LoginContext {
  ipAddress?: string;
  userAgent?: string;
}

/** Falhas consecutivas que disparam o lockout. */
export const LOCKOUT_THRESHOLD = 5;
/** Janela em que as falhas precisam acontecer para disparar (15 min). */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
/** Escada progressiva de bloqueio (minutos): 30min → 1h → 2h → 4h → 24h. */
export const LOCKOUT_LADDER_MINUTES = [30, 60, 120, 240, 1440];
/** Máximo de sessões simultâneas por usuário (issue #342: default 5). */
export const MAX_CONCURRENT_SESSIONS = 5;
/**
 * Sessão expira por inatividade após 60 min (decisão Rafael, #465 — ERP com
 * financeiro/fiscal/faturamento/permissões sensíveis não deve ter janela longa;
 * o access JWT curto de 15 min complementa). Este é o timeout PADRÃO do ERP;
 * um timeout menor por área sensível (financeiro, fiscal, banco, admin de
 * usuários/permissões) pode ser aplicado numa fase futura sobrepondo este valor
 * no ponto de validação — a estrutura de validação por sessão já suporta isso.
 */
export const SESSION_IDLE_TIMEOUT_MS = resolveIdleTimeoutMs();

/**
 * Minutos de ociosidade até a sessão morrer. Configurável porque o número
 * certo é decisão de negócio, não de código: 15 min protege um terminal
 * destravado no chão de fábrica; um escritório talvez queira 60.
 * `SESSION_IDLE_TIMEOUT_MINUTES` no ambiente; fora da faixa 1..1440 ou
 * inválido, cai no default.
 */
export function resolveIdleTimeoutMs(): number {
  const DEFAULT_MIN = 15;
  const bruto = Number(process.env.SESSION_IDLE_TIMEOUT_MINUTES);
  const minutos = Number.isFinite(bruto) && bruto >= 1 && bruto <= 1440 ? bruto : DEFAULT_MIN;
  return minutos * 60 * 1000;
}

/**
 * Debounce do heartbeat: com que frequência a atividade é gravada. Deriva do
 * timeout (um quinto), entre 30s e 5 min — com timeout de 15 min, grava no
 * máximo a cada 3 min, então o erro do relógio de ociosidade é ≤ 3 min.
 * Fixar 5 min seria grosseiro demais para um timeout curto.
 */
export const ACTIVITY_DEBOUNCE_MS = Math.min(
  5 * 60 * 1000,
  Math.max(30 * 1000, Math.floor(SESSION_IDLE_TIMEOUT_MS / 5)),
);

/** Mensagem do 423 — genérica de propósito (não revela se a conta existe). */
const LOCKED_MESSAGE =
  'Conta temporariamente bloqueada por excesso de tentativas. Tente novamente mais tarde.';

/** Resultado da validação de sessão no refresh. */
export interface SessionRefreshCheck {
  /** false = sessão revogada/expirada → refresh deve ser negado (401). */
  active: boolean;
  /** null = refresh token legado sem sessão (aceito na transição — Fase M4). */
  session: Pick<UserSession, 'id' | 'lastActivityAt'> | null;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly denylist: SessionDenylistService,
    // #343: @Optional() de propósito — auditoria é best-effort e a ausência
    // do serviço (ex.: testes existentes) nunca pode quebrar o fluxo.
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ─── Fingerprint ───────────────────────────────────────────────────────────

  /**
   * Fingerprint server-side do dispositivo. O fingerprint rico (user-agent +
   * screen + timezone, coletado no cliente) chega com a tela "meus
   * dispositivos" (#352); até lá o hash do user-agent já separa
   * navegador/máquina o suficiente para o alerta de device novo.
   */
  private fingerprintOf(userAgent?: string): string {
    return createHash('sha256')
      .update(userAgent ?? 'unknown')
      .digest('hex')
      .slice(0, 32);
  }

  // ─── Lockout ───────────────────────────────────────────────────────────────

  /**
   * Barra o login de conta bloqueada com 423 Locked. Mensagem genérica e
   * comportamento IDÊNTICO para e-mail existente e inexistente
   * (anti-enumeração). Falha de banco → fail-open logado.
   */
  async assertNotLocked(email: string, ctx: LoginContext = {}): Promise<void> {
    let lockedUntil: Date | null = null;
    try {
      lockedUntil = await this.resolveLockedUntil(email);
    } catch (err) {
      this.logger.warn(
        `Consulta de lockout falhou para login (fail-open): ${(err as Error).message}`,
      );
      return;
    }

    if (lockedUntil && lockedUntil > new Date()) {
      // Registra a tentativa barrada (não conta como nova falha de senha,
      // mas mantém a trilha e estende a visão do ataque em andamento).
      await this.recordAttemptRow(email, ctx, false, LoginFailReason.LOCKED);
      // 423 Locked (HttpStatus desta versão do Nest não tem a constante)
      throw new HttpException(LOCKED_MESSAGE, 423);
    }
  }

  /**
   * lockedUntil efetivo do e-mail: User.lockedUntil quando a conta existe;
   * para e-mail inexistente, derivado dos LoginAttempt (mesma política) para
   * manter a resposta indistinguível.
   */
  private async resolveLockedUntil(email: string): Promise<Date | null> {
    // tenant-lint: ok (pré-auth por email (lockout): email é único global, ainda não há tenant resolvido)
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { lockedUntil: true },
    });
    if (user) return user.lockedUntil;
    return this.deriveLockFromAttempts(email);
  }

  /**
   * Trava derivada só dos LoginAttempt (e-mails inexistentes): streak de
   * falhas consecutivas >= 5 com as últimas 5 dentro de 15 min → trava a
   * partir da última falha, com o degrau da escada correspondente ao streak.
   */
  private async deriveLockFromAttempts(email: string): Promise<Date | null> {
    const streakInfo = await this.failureStreak(email);
    if (!streakInfo.triggered) return null;
    const durationMs = LOCKOUT_LADDER_MINUTES[streakInfo.level] * 60 * 1000;
    return new Date(streakInfo.lastFailureAt!.getTime() + durationMs);
  }

  /**
   * Streak de falhas consecutivas (para no primeiro sucesso), olhando as
   * últimas 24h. `triggered` = streak atingiu múltiplo do threshold com as
   * últimas 5 falhas dentro da janela de 15 min.
   */
  private async failureStreak(email: string): Promise<{
    count: number;
    triggered: boolean;
    level: number;
    lastFailureAt: Date | null;
  }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const attempts = await this.prisma.loginAttempt.findMany({
      where: { email, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: LOCKOUT_THRESHOLD * (LOCKOUT_LADDER_MINUTES.length + 1),
      select: { success: true, createdAt: true, failReason: true },
    });

    let count = 0;
    for (const attempt of attempts) {
      if (attempt.success) break;
      count++;
    }
    if (count < LOCKOUT_THRESHOLD) {
      return { count, triggered: false, level: 0, lastFailureAt: null };
    }

    // As últimas THRESHOLD falhas precisam caber na janela de 15 min.
    const newest = attempts[0].createdAt;
    const thresholdOldest = attempts[LOCKOUT_THRESHOLD - 1].createdAt;
    const withinWindow = newest.getTime() - thresholdOldest.getTime() <= LOCKOUT_WINDOW_MS;
    if (!withinWindow) {
      return { count, triggered: false, level: 0, lastFailureAt: newest };
    }

    const level = Math.min(
      Math.floor(count / LOCKOUT_THRESHOLD) - 1,
      LOCKOUT_LADDER_MINUTES.length - 1,
    );
    return { count, triggered: true, level, lastFailureAt: newest };
  }

  /**
   * Registra a tentativa de login (sucesso ou falha). Em falha, avalia o
   * lockout: a cada bloco de LOCKOUT_THRESHOLD falhas consecutivas dentro da
   * janela, sobe um degrau da escada e persiste User.lockedUntil (quando a
   * conta existe) + SecurityEvent(LOCKOUT) síncrono (Decisão 5).
   * Best-effort: banco fora do ar não derruba o fluxo de login.
   */
  async recordLoginAttempt(
    email: string,
    ctx: LoginContext,
    success: boolean,
    failReason?: LoginFailReason,
  ): Promise<void> {
    try {
      await this.recordAttemptRowUnsafe(email, ctx, success, failReason);
      if (!success) {
        await this.evaluateLockout(email, ctx);
      }
    } catch (err) {
      this.logger.warn(`Falha ao registrar LoginAttempt (best-effort): ${(err as Error).message}`);
    }
  }

  /** Versão engolindo erro — usada onde o fluxo já decidiu a resposta. */
  private async recordAttemptRow(
    email: string,
    ctx: LoginContext,
    success: boolean,
    failReason?: LoginFailReason,
  ): Promise<void> {
    try {
      await this.recordAttemptRowUnsafe(email, ctx, success, failReason);
    } catch (err) {
      this.logger.warn(`Falha ao registrar LoginAttempt (best-effort): ${(err as Error).message}`);
    }
  }

  private async recordAttemptRowUnsafe(
    email: string,
    ctx: LoginContext,
    success: boolean,
    failReason?: LoginFailReason,
  ): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        email,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        success,
        failReason: success ? null : (failReason ?? LoginFailReason.WRONG_PASSWORD),
      },
    });
  }

  /** Dispara o lockout quando o streak cruza um múltiplo do threshold. */
  private async evaluateLockout(email: string, ctx: LoginContext): Promise<void> {
    const streak = await this.failureStreak(email);
    if (!streak.triggered) return;
    // Só age no exato momento em que fecha um bloco de 5 (evita reprocessar
    // o mesmo degrau a cada tentativa barrada durante a trava).
    if (streak.count % LOCKOUT_THRESHOLD !== 0) return;

    const durationMinutes = LOCKOUT_LADDER_MINUTES[streak.level];
    const lockedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, companyId: true },
    });

    if (user) {
      // Decisão 5: evento de segurança grava na MESMA transação da ação.
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: user.id },
          data: { lockedUntil },
        }),
        this.prisma.securityEvent.create({
          data: {
            companyId: user.companyId,
            userId: user.id,
            eventType: SecurityEventType.LOCKOUT,
            // 3º lockout seguido (nível >= 2, ou seja, 2h+) escala para
            // CRITICAL — insumo do "notificar admin após 3 lockouts".
            severity:
              streak.level >= 2 ? SecurityEventSeverity.CRITICAL : SecurityEventSeverity.WARNING,
            metadata: {
              email,
              consecutiveFailures: streak.count,
              lockLevel: streak.level,
              lockMinutes: durationMinutes,
            },
            ipAddress: ctx.ipAddress ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        }),
      ]);
    } else {
      // E-mail inexistente: sem User para travar — a trava é derivada dos
      // attempts (resolveLockedUntil). Registra só o evento (userId nulo).
      await this.prisma.securityEvent.create({
        data: {
          eventType: SecurityEventType.LOCKOUT,
          severity: SecurityEventSeverity.WARNING,
          metadata: {
            email,
            consecutiveFailures: streak.count,
            lockLevel: streak.level,
            lockMinutes: durationMinutes,
            unknownEmail: true,
          },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      });
    }

    this.logger.warn(
      `Lockout aplicado para ${email}: ${streak.count} falhas consecutivas → ${durationMinutes}min (nível ${streak.level}).`,
    );
  }

  /** Sucesso de login zera a trava. Best-effort. */
  async clearLockout(userId: string): Promise<void> {
    try {
      // tenant-lint: ok (plumbing de auth: userId já autenticado pelo fluxo)
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: null },
      });
    } catch (err) {
      this.logger.warn(`Falha ao limpar lockedUntil (best-effort): ${(err as Error).message}`);
    }
  }

  /** Destrava manual por admin (endpoint chega com a tela #352). */
  async unlockUser(userId: string, unlockedBy: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, companyId: true },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { lockedUntil: null } }),
      this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId,
          eventType: SecurityEventType.ACCOUNT_UNLOCKED,
          severity: SecurityEventSeverity.INFO,
          metadata: { unlockedBy },
        },
      }),
    ]);
  }

  // ─── Sessões ───────────────────────────────────────────────────────────────

  /**
   * Cria a sessão do login e amarra ao refresh token recém-emitido.
   * Efeitos colaterais: derruba a sessão mais antiga se estourar o limite de
   * 5 simultâneas e registra o dispositivo (SecurityEvent NEW_DEVICE quando
   * for a primeira vez). BEST-EFFORT: qualquer erro devolve null e o login
   * segue sem o claim sessionId (token tratado como legado — Fase M4).
   */
  async createSession(
    user: { id: string; companyId: string },
    ctx: LoginContext,
    refreshTokenId: string,
  ): Promise<UserSession | null> {
    try {
      await this.enforceSessionLimit(user.id);
      await this.registerDevice(user, ctx);

      return await this.prisma.userSession.create({
        data: {
          userId: user.id,
          companyId: user.companyId,
          refreshTokenId,
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
          deviceFingerprint: this.fingerprintOf(ctx.userAgent),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao criar UserSession (login segue sem sessionId): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Estourou o limite de 5 sessões ativas? Derruba a mais antiga. */
  private async enforceSessionLimit(userId: string): Promise<void> {
    // tenant-lint: ok (plumbing de auth: sessões do próprio userId)
    const active = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActivityAt: 'asc' },
      select: { id: true, refreshTokenId: true },
    });
    if (active.length < MAX_CONCURRENT_SESSIONS) return;

    const excess = active.slice(0, active.length - MAX_CONCURRENT_SESSIONS + 1);
    for (const session of excess) {
      await this.revokeSessionRow(session.id, session.refreshTokenId, SessionRevokedReason.EXPIRED);
    }
  }

  /** Upsert do TrustedDevice; primeira vez → SecurityEvent(NEW_DEVICE). */
  private async registerDevice(
    user: { id: string; companyId: string },
    ctx: LoginContext,
  ): Promise<void> {
    const fingerprint = this.fingerprintOf(ctx.userAgent);
    const existing = await this.prisma.trustedDevice.findUnique({
      where: { userId_fingerprint: { userId: user.id, fingerprint } },
    });

    if (existing) {
      await this.prisma.trustedDevice.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
      return;
    }

    await this.prisma.$transaction([
      this.prisma.trustedDevice.create({
        data: { userId: user.id, fingerprint },
      }),
      this.prisma.securityEvent.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          eventType: SecurityEventType.NEW_DEVICE,
          severity: SecurityEventSeverity.WARNING,
          metadata: { fingerprint },
          ipAddress: ctx.ipAddress ?? null,
          userAgent: ctx.userAgent ?? null,
        },
      }),
    ]);
  }

  /**
   * Validação de sessão no refresh (fluxo 5.2 da arquitetura):
   * - refresh sem sessão (emitido antes da M4) → aceito (transição);
   * - sessão revogada → nega;
   * - inatividade > 60 min → revoga com EXPIRED e nega.
   * Erro de banco → fail-open (aceita sem sessão), porque o refresh token em
   * si JÁ foi validado contra o banco pelo AuthService.
   */
  async validateSessionForRefresh(refreshTokenId: string): Promise<SessionRefreshCheck> {
    try {
      // tenant-lint: ok (plumbing de auth: refreshTokenId é segredo de posse do próprio usuário)
      const session = await this.prisma.userSession.findUnique({
        where: { refreshTokenId },
        select: { id: true, lastActivityAt: true, revokedAt: true },
      });
      if (!session) return { active: true, session: null };
      if (session.revokedAt) return { active: false, session: null };

      const idleMs = Date.now() - session.lastActivityAt.getTime();
      if (idleMs > SESSION_IDLE_TIMEOUT_MS) {
        await this.revokeSessionRow(session.id, refreshTokenId, SessionRevokedReason.EXPIRED);
        return { active: false, session: null };
      }

      return {
        active: true,
        session: { id: session.id, lastActivityAt: session.lastActivityAt },
      };
    } catch (err) {
      this.logger.warn(
        `Falha ao validar sessão no refresh (fail-open, sem sessionId): ${(err as Error).message}`,
      );
      return { active: true, session: null };
    }
  }

  /**
   * Rotação de refresh: a MESMA sessão passa a apontar para o novo token e
   * ganha heartbeat de atividade. Best-effort.
   */
  async attachRefreshToSession(sessionId: string, newRefreshTokenId: string): Promise<void> {
    try {
      // tenant-lint: ok (plumbing de auth: sessionId da própria sessão validada)
      await this.prisma.userSession.update({
        where: { id: sessionId },
        data: { refreshTokenId: newRefreshTokenId, lastActivityAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao reamarrar refresh à sessão (best-effort): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Heartbeat debounced (5 min) de lastActivityAt — será chamado pelo
   * JwtAuthGuard/interceptor na #341; exposto desde já.
   */
  async touchSession(sessionId: string): Promise<void> {
    try {
      const threshold = new Date(Date.now() - ACTIVITY_DEBOUNCE_MS);
      // tenant-lint: ok (plumbing de auth: heartbeat da própria sessão)
      await this.prisma.userSession.updateMany({
        where: { id: sessionId, revokedAt: null, lastActivityAt: { lt: threshold } },
        data: { lastActivityAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Falha no heartbeat da sessão (best-effort): ${(err as Error).message}`);
    }
  }

  /**
   * Ponto único da regra de INATIVIDADE, chamado a cada requisição
   * autenticada (JwtStrategy). Faz as duas coisas numa query só:
   *
   *   UPDATE ... SET lastActivityAt = agora
   *    WHERE id = ? AND revokedAt IS NULL AND lastActivityAt >= (agora - timeout)
   *
   * - afetou 1 linha  → sessão viva e atividade registrada;
   * - afetou 0 linhas → ou está revogada, ou passou do tempo ocioso. Só aí
   *   vale uma leitura para distinguir: se foi ociosidade, revoga com
   *   EXPIRED (a sessão some da tela "meus dispositivos" com o motivo certo).
   *
   * O `skipWrite` evita gravar a cada request: quem já foi tocado dentro da
   * janela de debounce só precisa ser LIDO, e leitura é barata.
   *
   * FAIL-OPEN por decisão: se o banco falhar, a requisição segue. Derrubar
   * todo mundo por instabilidade de infraestrutura seria pior que esticar a
   * ociosidade de alguém — e o access token ainda expira sozinho em 15 min.
   */
  async isSessionAliveAndTouch(sessionId: string, skipWrite = false): Promise<boolean> {
    const agora = Date.now();
    const limite = new Date(agora - SESSION_IDLE_TIMEOUT_MS);

    try {
      if (!skipWrite) {
        // tenant-lint: ok (plumbing de auth: touch atômico da própria sessão)
        const { count } = await this.prisma.userSession.updateMany({
          where: { id: sessionId, revokedAt: null, lastActivityAt: { gte: limite } },
          data: { lastActivityAt: new Date(agora) },
        });
        if (count > 0) return true;
      }

      // tenant-lint: ok (plumbing de auth: leitura da própria sessão)
      const sessao = await this.prisma.userSession.findUnique({
        where: { id: sessionId },
        select: { id: true, revokedAt: true, lastActivityAt: true, refreshTokenId: true },
      });
      // Token legado sem sessão persistida (#342): segue valendo até expirar.
      if (!sessao) return true;
      if (sessao.revokedAt) return false;

      const ocioso = agora - sessao.lastActivityAt.getTime() > SESSION_IDLE_TIMEOUT_MS;
      if (ocioso) {
        await this.revokeSessionRow(sessao.id, sessao.refreshTokenId, SessionRevokedReason.EXPIRED);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(
        `Falha ao validar ociosidade da sessão (fail-open): ${(err as Error).message}`,
      );
      return true;
    }
  }

  /** Sessões ativas do usuário — base da tela "meus dispositivos" (#352). */
  async listSessions(userId: string) {
    // tenant-lint: ok (plumbing de auth: sessões do próprio userId)
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastActivityAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        deviceFingerprint: true,
        city: true,
        country: true,
        lastActivityAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Revoga UMA sessão.
   *
   * ── #1001-C2: três papéis, três parâmetros ─────────────────────────────────
   * Antes havia só `expectedUserId`, e ele acumulava duas funções incompatíveis:
   * era o DONO esperado da sessão e, na auditoria, virava o ATOR. No caminho de
   * admin ele vinha `undefined`, então a trilha registrava o **dono da sessão**
   * como autor — era impossível saber quem tinha derrubado quem.
   *
   * Agora cada coisa tem seu nome:
   *   - `expectedUserId` — o DONO esperado. Presente = revogação da própria
   *     sessão; mismatch → 404, sem vazar existência (anti-IDOR).
   *   - `actorUserId`    — QUEM pediu a revogação. É o que vai para a trilha.
   *   - `allowedCompanyIds` — o ESCOPO autorizado. Sessão fora dele responde
   *     404, igual a inexistente: quem não pode agir sobre ela também não
   *     precisa saber que ela existe.
   *
   * Revogação crítica (ADMIN_REVOKE / SECURITY) entra na denylist Redis → o
   * access token morre imediatamente quando o guard consultar (#341); o
   * refresh é invalidado em qualquer caso.
   */
  async revokeSession(
    sessionId: string,
    reason: SessionRevokedReason,
    expectedUserId?: string,
    opcoes: { actorUserId?: string; allowedCompanyIds?: string[] } = {},
  ): Promise<void> {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, companyId: true, refreshTokenId: true, revokedAt: true },
    });
    const foraDoEscopo =
      !!opcoes.allowedCompanyIds && !opcoes.allowedCompanyIds.includes(session?.companyId ?? '');
    if (!session || (expectedUserId && session.userId !== expectedUserId) || foraDoEscopo) {
      // Mesma resposta para "não existe", "não é sua" e "fora do seu escopo":
      // distinguir os casos entregaria um oráculo de sessões alheias.
      throw new NotFoundException('Sessão não encontrada');
    }
    if (session.revokedAt) return; // idempotente

    await this.revokeSessionRow(session.id, session.refreshTokenId, reason);

    const ator = opcoes.actorUserId ?? expectedUserId ?? session.userId;

    await this.prisma.securityEvent.create({
      data: {
        companyId: session.companyId,
        // O evento continua sendo DA VÍTIMA: é o histórico de segurança dela
        // que precisa mostrar que a sessão caiu.
        userId: session.userId,
        eventType: SecurityEventType.SESSION_REVOKED,
        severity:
          reason === SessionRevokedReason.SECURITY
            ? SecurityEventSeverity.CRITICAL
            : SecurityEventSeverity.INFO,
        // #1001-C2: o ator vai no metadado. Sem isso, uma revogação
        // administrativa fica indistinguível de um logout do próprio usuário.
        metadata: {
          sessionId: session.id,
          reason,
          actorUserId: ator,
          porTerceiro: ator !== session.userId,
        },
      },
    });

    if (this.isCriticalRevocation(reason)) {
      await this.denylist.deny(session.id);
    }

    // #343 — EXEMPLO DE ADOÇÃO do AuditService.logWithDiff() em um service:
    // o "antes" e o "depois" reais da entidade geram o diff (só os campos
    // alterados são gravados). O AuditService nunca lança (fila → fallback
    // síncrono → log de erro), então o await aqui é seguro.
    await this.audit?.logWithDiff(
      { revokedAt: null, revokedReason: null },
      { revokedAt: new Date(), revokedReason: reason },
      {
        companyId: session.companyId,
        // #1001-C2: o ATOR, não a vítima. Era aqui que a trilha mentia:
        // `expectedUserId ?? session.userId` registrava o dono da sessão
        // sempre que um admin revogava, porque nesse caminho o expected é
        // undefined. Quem revogou ficava invisível.
        userId: ator,
        sessionId: session.id,
        entity: 'UserSession',
        entityId: session.id,
        action: AuditAction.UPDATE,
        module: 'iam',
      },
    );
  }

  /**
   * Logout global: revoga TODAS as sessões ativas do usuário.
   * `exceptSessionId` (#345): preserva a sessão informada — usado na troca de
   * senha para derrubar todos os OUTROS dispositivos sem deslogar o atual.
   */
  async revokeAllSessions(
    userId: string,
    reason: SessionRevokedReason,
    exceptSessionId?: string,
  ): Promise<number> {
    const sessions = await this.prisma.userSession.findMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      select: { id: true, companyId: true, refreshTokenId: true },
    });
    if (sessions.length === 0) return 0;

    for (const session of sessions) {
      await this.revokeSessionRow(session.id, session.refreshTokenId, reason);
      if (this.isCriticalRevocation(reason)) {
        await this.denylist.deny(session.id);
      }
    }

    await this.prisma.securityEvent.create({
      data: {
        companyId: sessions[0].companyId,
        userId,
        eventType: SecurityEventType.SESSION_REVOKED,
        severity:
          reason === SessionRevokedReason.SECURITY
            ? SecurityEventSeverity.CRITICAL
            : SecurityEventSeverity.INFO,
        metadata: { count: sessions.length, reason, global: true },
      },
    });

    return sessions.length;
  }

  /**
   * Revogação a partir do refresh token (logout). Best-effort.
   *
   * #67: quem autoriza é o chamador, não este método. O `AuthService.logout`
   * confere que `refreshToken.userId` é o usuário autenticado ANTES de chegar
   * aqui — posse do id não é autorização. Revogação de sessão de TERCEIRO não
   * passa por este caminho: usa `revokeSession`, com permissão, escopo de
   * empresas e SecurityEvent.
   */
  async revokeSessionByRefreshTokenId(
    refreshTokenId: string,
    reason: SessionRevokedReason,
  ): Promise<void> {
    try {
      // tenant-lint: ok (plumbing de auth: dono já conferido pelo AuthService)
      await this.prisma.userSession.updateMany({
        where: { refreshTokenId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao revogar sessão no logout (best-effort): ${(err as Error).message}`,
      );
    }
  }

  /** Marca a sessão como revogada e mata o refresh token vinculado. */
  private async revokeSessionRow(
    sessionId: string,
    refreshTokenId: string | null,
    reason: SessionRevokedReason,
  ): Promise<void> {
    // tenant-lint: ok (plumbing de auth: revogação da própria sessão)
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (refreshTokenId) {
      await this.prisma.refreshToken.updateMany({
        where: { id: refreshTokenId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  private isCriticalRevocation(reason: SessionRevokedReason): boolean {
    return (
      reason === SessionRevokedReason.ADMIN_REVOKE || reason === SessionRevokedReason.SECURITY
    );
  }

  // ─── Dispositivos ──────────────────────────────────────────────────────────

  /** Dispositivos conhecidos do usuário. */
  async listDevices(userId: string): Promise<TrustedDevice[]> {
    return this.prisma.trustedDevice.findMany({
      where: { userId },
      orderBy: { lastSeenAt: 'desc' },
    });
  }

  /** Marca um dispositivo como confiável (futuro: pular MFA nele). */
  async trustDevice(deviceId: string, userId: string, trustedBy: string): Promise<TrustedDevice> {
    const device = await this.prisma.trustedDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.userId !== userId) {
      throw new NotFoundException('Dispositivo não encontrado');
    }
    return this.prisma.trustedDevice.update({
      where: { id: deviceId },
      data: { trusted: true, trustedAt: new Date(), trustedBy },
    });
  }
}
