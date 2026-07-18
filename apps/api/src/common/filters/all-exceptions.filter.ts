import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  APP_SERVER_ERROR,
  ServerErrorEvent,
} from '../events/server-error.event';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  // Opcional para os testes que instanciam o filtro direto; via APP_FILTER o
  // Nest injeta o EventEmitter2 (global). Sem ele, a captura 5xx é pulada.
  constructor(private readonly events?: EventEmitter2) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message } = this.resolveException(exception);
    const requestId = request.headers['x-request-id'] ?? crypto.randomUUID();

    this.logger.error(
      `[${requestId}] ${request.method} ${request.url} → ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    );

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    });

    // WP2 (#766): captura automática de erro do servidor (5xx) — fire-and-forget,
    // fora do caminho da resposta; jamais afeta o cliente. Um listener do módulo
    // support cria o incidente (AUTO_ERROR) com dedup por assinatura de stack.
    if (status >= 500 && this.events) {
      try {
        const user = (request as { user?: { companyId?: string } }).user;
        const evt: ServerErrorEvent = {
          companyId: user?.companyId,
          route: request.url,
          method: request.method,
          requestId: String(requestId),
          errorName: exception instanceof Error ? exception.name : 'UnknownError',
          errorMessage:
            exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        };
        this.events.emit(APP_SERVER_ERROR, evt);
      } catch {
        /* a captura de suporte jamais quebra o filtro de erros */
      }
    }
  }

  private resolveException(exception: unknown): {
    status: number;
    message: string;
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : (res as any).message ?? exception.message;
      return {
        status: exception.getStatus(),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }

  private handlePrismaError(
    error: Prisma.PrismaClientKnownRequestError,
  ): { status: number; message: string } {
    switch (error.code) {
      case 'P2002': {
        const fields = (error.meta?.target as string[])?.join(', ') ?? 'unknown';
        return {
          status: HttpStatus.CONFLICT,
          message: `Unique constraint violation on: ${fields}`,
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          message: 'Record not found',
        };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          message: 'Foreign key constraint violation',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Internal server error',
        };
    }
  }
}
