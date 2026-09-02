import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import {
  ACCESS_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  extractBearerToken,
} from '../auth/auth-cookies';
import { SKIP_CSRF_KEY } from '../decorators/skip-csrf.decorator';

/**
 * CsrfGuard — proteção double-submit para o canal de autenticação por
 * cookie (#349). Registrado como guard GLOBAL, antes do JwtAuthGuard.
 *
 * O canal Bearer é imune a CSRF por construção (o atacante não injeta
 * header Authorization cross-site). O canal cookie NÃO é: o browser anexa
 * cookies sozinho. Regra:
 *
 *   0. Rota marcada com @SkipCsrf() → passa (login/logout — ver o decorator:
 *      sem essa saída, perder o segredo de CSRF tranca o usuário fora, já que
 *      nem reautenticar nem sair são possíveis enquanto o access cookie valer).
 *   1. Métodos de leitura (GET/HEAD/OPTIONS) → passa.
 *   2. Sem cookie de access (`gdr_access`) → passa — requisição não usa o
 *      canal cookie (Bearer, webhook com secret próprio, login inicial).
 *   3. Com header `Authorization: Bearer <token>` sintaticamente válido →
 *      passa — a autenticação será por ESSE Bearer (precedência do
 *      extractAccessToken/JwtStrategy), e o Bearer é prova de não-CSRF.
 *      Header não-Bearer (`Basic …`, malformado) NÃO isenta (#1145): a
 *      seleção de credencial cairia no cookie, e cookie exige CSRF. A
 *      decisão usa a MESMA função de seleção que a autenticação.
 *   4. Restou: mutação autenticável por cookie → exige header
 *      `x-csrf-token` idêntico ao cookie `gdr_csrf` (comparação em tempo
 *      constante). Divergiu/faltou → 403.
 *
 * Vale inclusive para rotas @Public: se o browser está numa sessão de
 * cookie, o front sempre manda o header (interceptor), e um formulário
 * cross-site nunca consegue mandá-lo — custo zero, cobertura total. As
 * exceções são as poucas rotas com @SkipCsrf().
 *
 * Na rejeição marca a resposta com `x-csrf-error: 1`. O filtro global de
 * exceções normaliza o corpo para `{status, message}` e descartaria um campo
 * `code`, então o header é o canal confiável para o front distinguir um 403
 * de CSRF (recuperável: renova a sessão e repete) de um 403 de permissão
 * (definitivo) sem depender do texto da mensagem.
 */
export const CSRF_ERROR_HEADER = 'x-csrf-error';

@Injectable()
export class CsrfGuard implements CanActivate {
  // Opcional: o guard é instanciado pelo Nest (APP_GUARD) com o Reflector,
  // mas os specs o constroem direto — sem reflector, nenhuma rota é isenta.
  constructor(private readonly reflector?: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isento = this.reflector?.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isento) return true;

    const req = context.switchToHttp().getRequest();

    const method: string = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;

    if (!req.cookies?.[ACCESS_COOKIE]) return true;
    if (extractBearerToken(req) !== null) return true;

    const esperado: string | undefined = req.cookies?.[CSRF_COOKIE];
    const recebido: string | undefined = req.headers?.[CSRF_HEADER];
    if (esperado && recebido && seguros(esperado, recebido)) return true;

    // Sinaliza ao cliente que este 403 é recuperável (renovar e repetir).
    context.switchToHttp().getResponse?.()?.setHeader?.(CSRF_ERROR_HEADER, '1');

    throw new ForbiddenException(
      'Requisição rejeitada pela proteção CSRF. Renove a sessão e tente novamente.',
    );
  }
}

function seguros(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
