import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenant } from '../context/tenant-context';

/**
 * TenantContextInterceptor — substitui o antigo TenantMiddleware (morto).
 *
 * Por que interceptor e não middleware: no NestJS, middleware roda ANTES
 * dos guards, então `req.user` ainda não existe nesse ponto (é o
 * JwtAuthGuard que o popula). Interceptors rodam DEPOIS dos guards, quando
 * o usuário autenticado já está no request.
 *
 * Este interceptor apenas coloca o companyId do usuário autenticado no
 * AsyncLocalStorage (tenant-context.ts). Quem propaga o tenant ao banco
 * (via `set_config('app.current_company_id', ..., true)` DENTRO de
 * transações) é o PrismaService + rls.extension — obrigatório porque a
 * conexão usa o pooler do Supabase em transaction mode (porta 6543), onde
 * `SET`/`SET LOCAL` fora de transação não é confiável.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const companyId: string | undefined = request?.user?.companyId;

    if (!companyId) {
      // Rotas @Public() ou usuário sem empresa (CompanyGuard já bloqueia
      // rotas protegidas sem companyId) — segue sem contexto de tenant.
      return next.handle();
    }

    // O handler da rota só executa quando o Observable é assinado; por isso
    // a assinatura precisa acontecer DENTRO do runWithTenant para que o
    // AsyncLocalStorage se propague a toda a cadeia assíncrona do handler.
    return new Observable((subscriber) => {
      const subscription = runWithTenant(companyId, () =>
        next.handle().subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }
}
