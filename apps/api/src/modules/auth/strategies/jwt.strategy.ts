import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { extractAccessToken } from '../../../common/auth/auth-cookies';
import { AccessSessionPolicy } from '../../iam/access-session-policy.service';
import { SessionDenylistService } from '../../iam/session-denylist.service';
import { IMPERSONATION_SCOPE } from '../../ops/impersonation.constants';
import { MFA_PENDING_SCOPE, PASSWORD_CHANGE_SCOPE } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    // Denylist do iid de impersonation (#913) — não é sessão de usuário.
    private readonly denylist: SessionDenylistService,
    // #1144: denylist de sessão (#823) + inatividade (#341) num serviço
    // compartilhado com o change-password. Regra de sessão nova vai LÁ.
    private readonly sessionPolicy: AccessSessionPolicy,
  ) {
    super({
      // #349: header Bearer tem PRECEDÊNCIA (clientes atuais); sem header,
      // cai no cookie httpOnly gdr_access (front migrado). O CsrfGuard
      // global compensa o risco de CSRF que o canal cookie introduz.
      // Fonte única (extractAccessToken) — a mesma que o change-password usa
      // fora do guard; divergir aqui recria o bug do canal cookie invisível.
      jwtFromRequest: (req: any) => extractAccessToken(req),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET'),
      // Defesa em profundidade: fixa o algoritmo aceito. Hoje o
      // `jsonwebtoken` já deriva HS256/384/512 de um secret string (então
      // `alg: none` nunca passaria), mas isso é comportamento implícito de
      // biblioteca — trocar o secret por uma chave pública no futuro faria a
      // derivação virar RS*, e um token forjado com alg trocado passaria a
      // ser aceito. Declarado, o contrato não depende disso.
      algorithms: ['HS256'],
    });
  }

  async validate(payload: any) {
    // #344/#345: tokens restritos (mfaPendingToken e passwordChangeToken)
    // são assinados com o mesmo secret mas têm escopo restrito — NUNCA
    // valem como access token.
    if (payload?.scope === MFA_PENDING_SCOPE || payload?.scope === PASSWORD_CHANGE_SCOPE) {
      throw new UnauthorizedException('Token restrito não é um access token');
    }

    // OPS WP6 (#913): token de IMPERSONATION vale como access token do usuário
    // ALVO, com contexto anexado — o ImpersonationReadonlyGuard global rejeita
    // toda mutação, e os guards de permissão resolvem pelo alvo (o operador vê
    // exatamente o que o cliente vê). Sem sessionId de propósito: nenhuma
    // sessão do cliente é tocada; revogação antecipada é pelo iid na denylist
    // (Redis fora = fail-open com teto de 30 min, mesmo trade-off da #823).
    if (payload?.scope === IMPERSONATION_SCOPE) {
      if (payload?.iid) {
        const ended = await this.denylist.isSessionDenylisted(payload.iid);
        if (ended) {
          throw new UnauthorizedException('Sessão de suporte encerrada.');
        }
      }
      return {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        companyId: payload.companyId,
        impersonation: {
          iid: payload.iid,
          impersonatorId: payload.impersonatorId,
          readOnly: payload.readOnly !== false,
        },
      };
    }

    // #823 (denylist) + #341 (inatividade): validações de sessão do access
    // token normal. Este é o ponto comum de TODO access token que entra pelo
    // guard global — e o change-password (@Public, verifica o token por
    // conta própria) chama a MESMA policy (#1144).
    await this.sessionPolicy.assertUsable(payload);

    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      // #1119: a empresa ATIVA da sessão — é ela que escopa toda a API. Para
      // quem não tem grupo econômico (a maioria), é a mesma do cadastro.
      companyId: payload.companyId,
      // #1119: a empresa de CADASTRO, âncora da autorização de troca. Claim
      // opcional: token emitido antes do #1119 não tem, e aí o fallback é o
      // próprio companyId — que para esses tokens É o cadastro.
      homeCompanyId: payload.homeCompanyId ?? payload.companyId,
      // #342 (IAM v2, Decisão 4): claim OPCIONAL — tokens antigos não têm.
      sessionId: payload.sessionId,
    };
  }
}
