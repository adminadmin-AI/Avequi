import { Controller, Get, Header, HttpStatus, Logger, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthRedis } from './health.redis';

/** Tempo máximo que cada dependência tem para responder (#1102). */
export const HEALTH_TIMEOUT_MS = 2000;

/** Vocabulário FECHADO da resposta pública — nada fora disto sai daqui. */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export type CheckStatus = 'up' | 'down';

export interface HealthResponse {
  status: HealthStatus;
  uptime: number;
  checks: { database: CheckStatus; redis: CheckStatus };
}

/**
 * Corre `promise` contra um relógio. Nunca lança e nunca pendura a requisição:
 * qualquer erro OU estouro do prazo vira `false`.
 *
 * O `clearTimeout` no `finally` é o que impede um timer pendurado por checagem
 * (handle aberto = processo que não encerra e teste que reclama de vazamento).
 */
async function comPrazo(promise: Promise<boolean>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.catch(() => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
        timer.unref?.();
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `GET /api/health` — saúde real da API (#1102, parte de #1024).
 *
 * Público de propósito: existe para um monitor EXTERNO alcançar sem
 * credencial. Por isso a resposta é um vocabulário fechado de seis palavras —
 * quem chama descobre SE funciona, nunca COMO é feito. Detalhe de erro vai
 * para o log da aplicação, jamais para o corpo HTTP.
 *
 * ⚠️ O código 503 é escrito direto na `Response` (`passthrough`) em vez de
 * lançar `ServiceUnavailableException` DE PROPÓSITO: o AllExceptionsFilter
 * global emite `APP_SERVER_ERROR` em todo status >= 500, e o módulo de suporte
 * transforma isso em incidente AUTO_ERROR. Lançar aqui abriria um incidente por
 * batida do monitor enquanto o banco estivesse fora — dezenas de incidentes
 * idênticos durante justamente a pior hora possível.
 *
 * Semântica dos estados (justificada no código, não por suposição):
 * - banco fora  → `unhealthy` + 503. Sem banco não existe requisição útil.
 * - Redis fora  → `degraded` + 200. PermissionCacheService e
 *   SessionDenylistService têm fallback gracioso DOCUMENTADO (resolvem no
 *   banco / fail-open) e a auditoria tem fallback síncrono: o ERP segue
 *   vendendo, faturando e autenticando. Devolver 503 aqui produziria
 *   indisponibilidade falsa na apuração de SLA (#1024).
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: HealthRedis,
  ) {}

  @Public()
  @Get()
  // Resposta de saúde nunca pode ser servida de cache — um 200 velho de um
  // proxy esconderia exatamente a queda que este endpoint existe para mostrar.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Saúde da API: banco + Redis (público, para monitor externo)' })
  @ApiResponse({ status: 200, description: 'healthy (tudo no ar) ou degraded (Redis fora)' })
  @ApiResponse({ status: 503, description: 'unhealthy — banco inacessível' })
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [database, redis] = await Promise.all([
      comPrazo(this.checarBanco(), HEALTH_TIMEOUT_MS),
      comPrazo(this.redis.ping(), HEALTH_TIMEOUT_MS),
    ]);

    const status: HealthStatus = !database ? 'unhealthy' : redis ? 'healthy' : 'degraded';
    res.status(database ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status,
      uptime: Math.floor(process.uptime()),
      checks: { database: database ? 'up' : 'down', redis: redis ? 'up' : 'down' },
    };
  }

  /** `SELECT 1` na conexão que o Prisma já mantém — não abre conexão nova. */
  private async checarBanco(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      // A mensagem do driver traz host, porta e às vezes credencial: fica no
      // log da aplicação e NUNCA na resposta (#1102).
      this.logger.warn(`Banco indisponível no health check: ${(err as Error).message}`);
      return false;
    }
  }
}
