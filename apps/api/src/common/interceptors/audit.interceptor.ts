import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('AuditLog');

  private readonly AUDITED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

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
      }),
    );
  }
}
