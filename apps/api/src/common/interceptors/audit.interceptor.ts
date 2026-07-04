import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  Optional,
} from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { redactSensitive } from '../../modules/iam/audit-diff.util';
import { AuditService } from '../../modules/iam/audit.service';

/** Método HTTP → AuditAction do schema v2 (#337). */
const METHOD_TO_ACTION: Record<string, AuditAction> = {
  POST: AuditAction.CREATE,
  PUT: AuditAction.UPDATE,
  PATCH: AuditAction.UPDATE,
  DELETE: AuditAction.DELETE,
};

/**
 * AuditInterceptor v2 (issue #343): além do log de console (comportamento
 * original, mantido — os specs do PR #456 continuam válidos), toda mutation
 * autenticada é PERSISTIDA em gdr_audit_logs_v2 via AuditService (fila Bull
 * com fallback síncrono — Decisão 5 da arquitetura IAM v2).
 *
 * O AuditService é injetado como @Optional() de propósito:
 * - `new AuditInterceptor()` (testes existentes) continua funcionando
 *   no modo console-only;
 * - auditoria é best-effort por design — a ausência do serviço nunca
 *   quebra a request.
 *
 * O interceptor NÃO tem o estado "antes" da entidade (sem diff): grava a
 * intenção (body redigido) como newValue. Diff de verdade é responsabilidade
 * dos services via AuditService.logWithDiff() (adoção gradual).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  private readonly AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  constructor(@Optional() private readonly auditService?: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.AUDITED_METHODS.has(request.method)) {
      return next.handle();
    }

    const user = (request as any).user;
    const startTime = Date.now();

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log({
          action: `${request.method} ${request.url}`,
          userId: user?.id ?? 'anonymous',
          companyId: user?.companyId ?? 'none',
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        });

        // #343: persistência real (fire-and-forget — o AuditService nunca
        // lança; a request não espera nem depende da auditoria).
        this.persistAudit(request, user, duration);
      }),
    );
  }

  /** Monta a entrada e delega ao AuditService. Nunca lança. */
  private persistAudit(request: Request, user: any, duration: number): void {
    try {
      if (!this.auditService) return; // modo console-only (sem DI)
      // Sem usuário/tenant não há como satisfazer o FK companyId do
      // AuditLogV2 — requests anônimas ficam só no console (login/logout
      // são cobertos pelos SecurityEvents síncronos do SessionService).
      if (!user?.companyId) return;

      const segments = this.pathSegments(request.url);
      // Rotas de auth não entram no audit trail de negócio: credenciais no
      // body e eventos já cobertos por SecurityEvent (Decisão 5).
      if (segments[0] === 'auth') return;

      const body = request.body;
      const hasBody =
        body && typeof body === 'object' && Object.keys(body).length > 0;

      void this.auditService.log({
        companyId: user.companyId,
        userId: user.id ?? null,
        sessionId: user.sessionId ?? null,
        entity: segments[0] ?? 'unknown',
        entityId: segments[1] ?? null,
        action: METHOD_TO_ACTION[request.method] ?? AuditAction.OTHER,
        module: segments[0] ?? null,
        // Sem estado "antes" no interceptor — newValue registra a intenção
        // da mutation (body redigido). Diff real: logWithDiff nos services.
        newValue: hasBody ? redactSensitive(body) : undefined,
        ipAddress: request.ip ?? null,
        userAgent: (request.headers['user-agent'] as string) ?? null,
        requestId: (request.headers['x-request-id'] as string) ?? null,
        duration,
      });
    } catch (err) {
      // Qualquer erro na montagem é engolido — auditoria nunca derruba request.
      this.logger.warn(`Falha ao montar audit log (ignorada): ${(err as Error).message}`);
    }
  }

  /** Segmentos do path sem query string e sem o prefixo global "api". */
  private pathSegments(url: string): string[] {
    const path = (url ?? '').split('?')[0];
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'api') segments.shift();
    return segments;
  }
}
