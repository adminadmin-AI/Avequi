import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerRequest } from '@nestjs/throttler/dist/throttler.guard.interface';

/**
 * Rate limiting adaptativo (#349) — evolui o ThrottlerGuard padrão em 2 eixos:
 *
 * 1. TRACKER POR USUÁRIO: autenticado conta por `user:{id}` (não por IP) —
 *    uma loja inteira atrás do mesmo NAT não esgota o limite coletivamente,
 *    e um usuário abusivo não se esconde trocando de IP. Anônimo segue por IP.
 *
 * 2. LIMITE ADAPTATIVO: usuário autenticado ("confiável" — passou por senha,
 *    lockout e MFA quando exigido) ganha o teto GLOBAL multiplicado
 *    (default 2× → 120 req/min). Limites ESTRITOS de rota (@Throttle com
 *    limite < 60: login 5/min, refresh 10/min, exports 10/min) NUNCA são
 *    inflados — a heurística só amplia o teto genérico, nunca a proteção
 *    pontual de endpoint sensível.
 *
 * Os headers X-RateLimit-Limit / -Remaining / -Reset já são emitidos pelo
 * próprio @nestjs/throttler v6 (setHeaders default) — checklist do #349.
 *
 * Roda como APP_GUARD DEPOIS do JwtAuthGuard (ordem do app.module), então
 * `req.user` já está resolvido quando o tracker/limite são calculados.
 */

/** Teto global (espelho do ThrottlerModule.forRoot — mantenha em sincronia) */
export const GLOBAL_RATE_LIMIT = 60;

/** Multiplicador para autenticados (env RATE_LIMIT_TRUSTED_MULTIPLIER, default 2) */
export function trustedMultiplier(): number {
  const raw = Number(process.env.RATE_LIMIT_TRUSTED_MULTIPLIER);
  return Number.isFinite(raw) && raw >= 1 ? raw : 2;
}

@Injectable()
export class AdaptiveThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (req.user?.id) return `user:${req.user.id}`;
    return req.ips?.length ? req.ips[0] : req.ip;
  }

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const req = props.context.switchToHttp().getRequest();
    const isTrusted = !!req.user?.id;
    // Só amplia o teto GLOBAL; limites estritos de rota ficam intactos.
    if (isTrusted && props.limit >= GLOBAL_RATE_LIMIT) {
      return super.handleRequest({
        ...props,
        limit: Math.ceil(props.limit * trustedMultiplier()),
      });
    }
    return super.handleRequest(props);
  }
}
