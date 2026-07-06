import { Prisma } from '@prisma/client';
import {
  getTenantCompanyId,
  isInsidePrismaTransaction,
} from '../common/context/tenant-context';

/**
 * Superfície mínima do PrismaClient usada pela extensão RLS.
 * Mantida como interface para permitir testes unitários com client fake
 * (convenção do projeto: nunca banco real em teste unitário).
 */
export interface RlsClientLike {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Prisma.PrismaPromise<number>;
  $transaction(ops: Prisma.PrismaPromise<unknown>[]): Promise<unknown[]>;
}

type RlsQueryArgs = {
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
};

/**
 * Handler aplicado a TODAS as operações de model do Prisma.
 *
 * Quando há tenant no contexto (request autenticado) e a operação NÃO está
 * dentro de uma transação já aberta, a query é executada dentro de uma
 * batch transaction cujo primeiro statement define o tenant:
 *
 *   SELECT set_config('app.current_company_id', $1, true)   -- parametrizado
 *   <query original>
 *
 * Esse é o padrão documentado pelo Prisma para RLS e é o ÚNICO mecanismo
 * confiável com o pooler do Supabase em transaction mode (porta 6543):
 * `set_config(..., true)` vale apenas para a transação corrente, que o
 * pooler garante rodar inteira na mesma conexão física.
 *
 * Quando já existe transação aberta (flag no AsyncLocalStorage, setada pelo
 * PrismaService.$transaction), a query passa direto — o set_config já foi
 * injetado no início daquela transação e abrir outra aqui causaria deadlock
 * com connection_limit=1.
 */
export function createRlsQueryHandler(client: RlsClientLike) {
  return async function rlsQueryHandler({ args, query }: RlsQueryArgs) {
    const companyId = getTenantCompanyId();

    if (!companyId || isInsidePrismaTransaction()) {
      return query(args);
    }

    const [, result] = await client.$transaction([
      client.$executeRaw`SELECT set_config('app.current_company_id', ${companyId}, TRUE)`,
      query(args) as Prisma.PrismaPromise<unknown>,
    ]);
    return result;
  };
}

/**
 * Extensão Prisma que aplica o handler acima a todos os models/operações.
 */
export function createRlsExtension(client: RlsClientLike) {
  return Prisma.defineExtension({
    name: 'rls-tenant-context',
    query: {
      $allModels: {
        $allOperations: createRlsQueryHandler(client),
      },
    },
  });
}
