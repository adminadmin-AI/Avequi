import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SessionDenylistService } from './session-denylist.service';
import { ACTIVITY_DEBOUNCE_MS, SessionService } from './session.service';

/**
 * AccessSessionPolicy — as validações de SESSÃO que todo access token
 * normal precisa passar, num único lugar (#1144).
 *
 * Antes viviam dentro da `JwtStrategy.validate`, e por isso só valiam para
 * quem entrava pelo guard global. `POST /auth/change-password` (rota
 * @Public que verifica o access token por conta própria — ver
 * AuthService.resolveChangePasswordIdentity) aceitava um token de sessão
 * revogada/denylistada ou encerrada por inatividade, desde que o JWT ainda
 * não tivesse expirado. Agora a strategy e o change-password chamam ISTO;
 * regra nova de sessão entra aqui e vale para os dois de uma vez.
 *
 * O que verifica, na ordem:
 *   1. #823 — sessão na denylist Redis (SECURITY/ADMIN_REVOKE: inativação,
 *      troca de senha, reset por admin) → 401 genérico. Redis fora →
 *      fail-open dentro do serviço (janela = expiração natural do token).
 *   2. #341 — sessão viva no banco; a requisição empurra o relógio de
 *      ociosidade (com debounce em memória para não gravar a cada chamada).
 *      Encerrada/ociosa → 401.
 *
 * Token legado SEM sessionId (transição M4, #342) não tem sessão para
 * consultar — passa, como documentado. O que NÃO é daqui: escopo do token
 * (restrito/impersonation) e assinatura/algoritmo — isso é de quem verifica
 * o JWT antes de chamar.
 */
@Injectable()
export class AccessSessionPolicy {
  /**
   * Última gravação de atividade por sessão, em memória. Sem isto, uma tela
   * que dispara 10 chamadas geraria 10 UPDATEs no mesmo segundo. Dentro da
   * janela de debounce a sessão só é LIDA (barato); passou da janela, grava.
   * Cache local ao processo: com várias instâncias, o pior caso é gravar
   * mais vezes — nunca deixar de expirar.
   */
  private readonly ultimaGravacao = new Map<string, number>();

  constructor(
    private readonly denylist: SessionDenylistService,
    private readonly sessions: SessionService,
  ) {}

  /** Lança 401 se a sessão do payload não pode mais autenticar. */
  async assertUsable(payload: { sessionId?: string } | null | undefined): Promise<void> {
    const sessionId = payload?.sessionId;
    if (!sessionId) return;

    // Mensagem genérica: não revela o motivo da revogação.
    const denied = await this.denylist.isSessionDenylisted(sessionId);
    if (denied) {
      throw new UnauthorizedException('Sessão inválida ou expirada. Faça login novamente.');
    }

    const agora = Date.now();
    const ultima = this.ultimaGravacao.get(sessionId) ?? 0;
    const dentroDoDebounce = agora - ultima < ACTIVITY_DEBOUNCE_MS;

    const viva = await this.sessions.isSessionAliveAndTouch(sessionId, dentroDoDebounce);
    if (!viva) {
      this.ultimaGravacao.delete(sessionId);
      throw new UnauthorizedException('Sessão encerrada por inatividade. Faça login novamente.');
    }
    if (!dentroDoDebounce) this.ultimaGravacao.set(sessionId, agora);
  }
}
