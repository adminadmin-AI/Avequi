import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { createRlsExtension } from './rls.extension';
import {
  getTenantCompanyId,
  runInsidePrismaTransaction,
  runWithTenant,
} from '../common/context/tenant-context';

function createExtendedClient(base: PrismaClient) {
  return base.$extends(createRlsExtension(base));
}

type ExtendedClient = ReturnType<typeof createExtendedClient>;

/**
 * PrismaService com propagação de tenant para as policies de RLS.
 *
 * Composição (em vez de `extends PrismaClient`):
 *  - `baseClient`: PrismaClient puro (usado para $connect e para o
 *    statement de set_config dentro das batch transactions);
 *  - `extendedClient`: client com a extensão RLS (rls.extension.ts), que
 *    envolve cada operação de model em uma transação com
 *    `SELECT set_config('app.current_company_id', $1, true)` parametrizado
 *    quando há tenant no AsyncLocalStorage;
 *  - Proxy no construtor delega qualquer propriedade não definida aqui
 *    (models, $queryRaw, etc.) ao extendedClient — os call sites existentes
 *    (`this.prisma.product.findMany(...)`) continuam funcionando sem mudança.
 *
 * `$transaction` é sobrescrito para injetar o set_config como PRIMEIRO
 * statement da transação (formas interativa e batch), pois com o pooler do
 * Supabase em transaction mode (porta 6543) o tenant só pode ser definido
 * dentro da própria transação. A flag insidePrismaTransaction impede que a
 * extensão RLS abra transação aninhada (deadlock com connection_limit=1).
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly baseClient: PrismaClient;
  private readonly extendedClient: ExtendedClient;

  constructor() {
    this.baseClient = new PrismaClient();
    this.extendedClient = createExtendedClient(this.baseClient);

    // Sobrescreve $transaction como propriedade própria da instância para
    // que a tipagem continue vindo do PrismaClient (interface mesclada
    // abaixo) e o Proxy a encontre antes de delegar ao extendedClient.
    (this as any).$transaction = this.runTenantTransaction.bind(this);

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        const value = (target.extendedClient as any)[prop];
        return typeof value === 'function'
          ? value.bind(target.extendedClient)
          : value;
      },
    });
  }

  async onModuleInit() {
    await this.baseClient.$connect();
  }

  async onModuleDestroy() {
    await this.baseClient.$disconnect();
  }

  /**
   * Substitui PrismaClient.$transaction injetando o tenant do contexto
   * como primeiro statement da transação (parametrizado, sem Unsafe).
   */
  private async runTenantTransaction(arg: any, options?: any): Promise<any> {
    const companyId = getTenantCompanyId();

    // Forma interativa: $transaction(async (tx) => { ... })
    if (typeof arg === 'function') {
      // Cast: a tipagem genérica de $transaction do client estendido explode
      // o compilador (TS2589/TS2615) com 54 models; o contrato é idêntico.
      return (this.extendedClient.$transaction as any)(
        async (tx: Prisma.TransactionClient) => {
          if (companyId) {
            await tx.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, TRUE)`;
          }
          return runInsidePrismaTransaction(() => arg(tx));
        },
        options,
      );
    }

    // Forma batch: $transaction([op1, op2, ...])
    if (companyId) {
      const setTenant = this.baseClient
        .$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, TRUE)`;
      const results = await runInsidePrismaTransaction(() =>
        (this.extendedClient.$transaction as any)([setTenant, ...arg], options),
      );
      // Remove o resultado do set_config para preservar o contrato original.
      return results.slice(1);
    }

    return runInsidePrismaTransaction(() =>
      (this.extendedClient.$transaction as any)(arg, options),
    );
  }

  /**
   * Executa `fn` dentro de uma transação com o tenant explícito — para
   * fluxos SEM request HTTP (jobs Bull, cron do AlertScheduler, scripts),
   * onde o TenantContextInterceptor não populou o AsyncLocalStorage.
   *
   * Usage:
   *   const result = await this.prisma.$transactionWithTenant(companyId, async (tx) => {
   *     return tx.product.findMany();
   *   });
   */
  async $transactionWithTenant<T>(
    companyId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return runWithTenant(companyId, () => this.$transaction(fn));
  }
}

// Mescla a tipagem do PrismaClient na do PrismaService: em runtime o Proxy
// delega models/$queryRaw/etc. ao extendedClient; em compile time os call
// sites continuam enxergando a API completa do PrismaClient.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PrismaService extends PrismaClient {}
