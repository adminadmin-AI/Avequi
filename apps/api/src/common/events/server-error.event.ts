/**
 * Emitido pelo AllExceptionsFilter em todo erro 5xx e consumido pelo módulo
 * support (#766) para captura automática de incidente. Fica em common/ para
 * não acoplar o filtro (camada common) ao módulo de domínio.
 */
export const APP_SERVER_ERROR = 'app.server_error';

export interface ServerErrorEvent {
  /** Tenant do request (do JWT). Ausente = erro sem tenant → ignorado nesta fase. */
  companyId?: string;
  route?: string;
  method?: string;
  /** Mesmo requestId logado pelo filtro — correlação com o log do servidor. */
  requestId?: string;
  errorName: string;
  errorMessage: string;
  stack?: string;
}
