import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
} from '../auth/auth-cookies';

/**
 * CsrfGuard — proteção double-submit para o canal de autenticação por
 * cookie (#349). Registrado como guard GLOBAL, antes do JwtAuthGuard.
 *
 * O canal Bearer é imune a CSRF por construção (o atacante não injeta
 * header Authorization cross-site). O canal cookie NÃO é: o browser anexa
 * cookies sozinho. Regra:
 *
 *   1. Métodos de leitura (GET/HEAD/OPTIONS) → passa.
 *   2. Sem cookie de access (`gdr_access`) → passa — requisição não usa o
 *      canal cookie (Bearer, webhook com secret próprio, login inicial).
 *   3. Com header Authorization → passa — a autenticação será pelo Bearer
 *      (precedência do JwtStrategy), e o Bearer é prova de não-CSRF.
 *   4. Restou: mutação autenticável por cookie → exige header
 *      `x-csrf-token` idêntico ao cookie `gdr_csrf` (comparação em tempo
 *      constante). Divergiu/faltou → 403.
 *
 * Vale inclusive para rotas @Public: se o browser está numa sessão de
 * cookie, o front sempre manda o header (interceptor), e um formulário
 * cross-site nunca consegue mandá-lo — custo zero, cobertura total.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const method: string = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

    if (!req.cookies?.[ACCESS_COOKIE]) return true;
    if (req.headers?.authorization) return true;

    const esperado: string | undefined = req.cookies?.[CSRF_COOKIE];
    const recebido: string | undefined = req.headers?.[CSRF_HEADER];
    if (esperado && recebido && seguros(esperado, recebido)) return true;

    throw new ForbiddenException(
      'Requisição rejeitada pela proteção CSRF. Recarregue a página e tente novamente.',
    );
  }
}

function seguros(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
