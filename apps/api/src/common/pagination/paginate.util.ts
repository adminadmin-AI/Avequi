/**
 * Contrato canônico de paginação (#1028) — generaliza o padrão já correto em
 * `modules/crm/lead-list.service.ts:45-73` para uso em qualquer módulo.
 *
 * Regras:
 *  - Envelope único: `{ items, total, page, pageSize }`.
 *  - `pageSize` sempre com clamp 1..100 — cliente nunca escolhe ilimitado.
 *  - Desempate estável por `id`: se o `orderBy` do chamador não referenciar
 *    `id`, o util acrescenta `{ id: 'asc' }` como critério final. Sem isso,
 *    `take/skip` sobre um campo com valores repetidos (ex: `createdAt` no
 *    mesmo milissegundo) pode repetir ou pular registro entre páginas.
 *
 * O chamador fornece `count`/`findMany` como closures que chamam o Prisma
 * diretamente (com `where`/`select`/`include` próprios do model) — o util
 * só orquestra skip/take/orderBy e o envelope. Isso preserva 100% da
 * inferência de tipo do Prisma Client (select narrowing) em vez de tentar
 * reconstruir a assinatura do delegate genericamente.
 *
 * NÃO serve para export/relatório de conjunto completo — isso é cursor +
 * streaming em lote (fora do escopo desta primeira parte da #1028).
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** default do `take` de endpoints "options" (combobox de formulário) — #1028 parte 2 */
export const DEFAULT_OPTIONS_TAKE = 50;

export interface PaginatedResult<Item> {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
}

/** page >= 1 sempre — página inválida ou ausente vira 1. */
export function clampPage(page?: number | null): number {
  const n = Number(page);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 1;
}

/** pageSize sempre em 1..100 — default 25 quando ausente/inválido. */
export function clampPageSize(pageSize?: number | null): number {
  if (pageSize === undefined || pageSize === null) return DEFAULT_PAGE_SIZE;
  const n = Number(pageSize);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_PAGE_SIZE);
}

/**
 * `take` sempre em 1..100 — default 50 quando ausente/inválido. Mesmo teto de
 * `clampPageSize` (nunca ilimitado), mas default maior: endpoint de opções
 * (combobox de formulário) não pagina — devolve um lote único já ordenado,
 * e 50 cobre a maioria dos catálogos sem exigir busca.
 */
export function clampTake(take?: number | null): number {
  if (take === undefined || take === null) return DEFAULT_OPTIONS_TAKE;
  const n = Number(take);
  if (!Number.isFinite(n)) return DEFAULT_OPTIONS_TAKE;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_PAGE_SIZE);
}

/**
 * Acrescenta desempate por `id` ao(s) critério(s) de ordenação, a menos que
 * o chamador já tenha incluído `id` explicitamente.
 */
export function withStableTiebreak<OrderBy>(orderBy: OrderBy | OrderBy[]): OrderBy[] {
  const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
  const hasIdClause = clauses.some(
    (clause) => clause != null && typeof clause === 'object' && 'id' in (clause as Record<string, unknown>),
  );
  if (hasIdClause) return clauses;
  return [...clauses, { id: 'asc' } as OrderBy];
}

export interface PaginateArgs<Item, OrderBy> {
  /** critério(s) de ordenação do chamador — o util cuida do desempate por id */
  orderBy: OrderBy | OrderBy[];
  page?: number | null;
  pageSize?: number | null;
  count: () => Promise<number>;
  findMany: (args: { skip: number; take: number; orderBy: OrderBy[] }) => Promise<Item[]>;
}

/**
 * Executa `count` + `findMany` em paralelo com paginação, teto e desempate
 * estável já aplicados. Uso típico:
 *
 *   return paginate({
 *     orderBy: { createdAt: 'desc' },
 *     page: query.page,
 *     pageSize: query.pageSize,
 *     count: () => this.prisma.product.count({ where }),
 *     findMany: (args) => this.prisma.product.findMany({ where, select: PRODUCT_LIST_SELECT, ...args }),
 *   });
 */
export async function paginate<Item, OrderBy>(
  args: PaginateArgs<Item, OrderBy>,
): Promise<PaginatedResult<Item>> {
  const page = clampPage(args.page);
  const pageSize = clampPageSize(args.pageSize);
  const orderBy = withStableTiebreak(args.orderBy);

  const [total, items] = await Promise.all([
    args.count(),
    args.findMany({ skip: (page - 1) * pageSize, take: pageSize, orderBy }),
  ]);

  return { items, total, page, pageSize };
}
