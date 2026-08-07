import { Readable } from 'stream';

/**
 * Export CSV server-side via cursor — #1032.
 *
 * Fecha o gap que a #1028 deixou documentado em `paginate.util.ts`: "NÃO
 * serve para export/relatório de conjunto completo — isso é cursor +
 * streaming em lote". Este util cuida de DUAS coisas: formatar CSV (mesmo
 * separador `;` + BOM do export client-side legado, `data-table.tsx`) e
 * orquestrar o loop de cursor. Nunca decide `where`/`select`/permissão —
 * isso é do chamador, mesmo contrato de responsabilidade de `paginate()`.
 *
 * ── Por que nunca carrega o conjunto inteiro em memória ─────────────────────
 * `fetchBatch` traz no máximo `batchSize` linhas por chamada (default
 * `CSV_EXPORT_BATCH_SIZE`, 500). O generator só chama `fetchBatch` de novo
 * DEPOIS de esgotar (yield de cada linha) o lote anterior — e cada `yield`
 * é uma linha por vez, não o lote inteiro de uma vez, então o
 * `Readable.from` (que respeita backpressure) só puxa a próxima linha
 * quando a resposta HTTP já drenou a anterior. Em nenhum ponto do processo
 * existe uma variável com o conjunto completo — só o lote corrente (no
 * máximo `batchSize` registros) e o buffer interno do stream (poucas
 * linhas, `highWaterMark` do Node).
 */

export interface CsvColumn<T> {
  header: string;
  value: (item: T) => unknown;
}

export interface CursorBatch<T> {
  items: T[];
  /** cursor para a PRÓXIMA chamada — ausente/undefined encerra o loop */
  nextCursor?: string;
}

/** O chamador decide a query Prisma (where/select/orderBy); este tipo só
 *  descreve o contrato de paginação por cursor que o util consome. */
export type CursorBatchFetcher<T> = (
  cursor: string | undefined,
  batchSize: number,
) => Promise<CursorBatch<T>>;

/** Lote por chamada ao banco — pequeno o bastante para não pesar na
 *  memória, grande o bastante para não virar N+1 de round-trips. */
export const CSV_EXPORT_BATCH_SIZE = 500;

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /["\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvLine(values: unknown[]): string {
  return values.map(escapeCsvCell).join(';') + '\r\n';
}

/**
 * Gera um Readable de CSV puxando lotes via cursor SOB DEMANDA — ver
 * cabeçalho do arquivo para a garantia de memória limitada.
 */
export function createCsvCursorStream<T>(
  columns: CsvColumn<T>[],
  fetchBatch: CursorBatchFetcher<T>,
  batchSize: number = CSV_EXPORT_BATCH_SIZE,
  /**
   * Chamado com o total de linhas emitidas quando o stream se esgota.
   * Serve para a trilha de auditoria saber o TAMANHO do que saiu (#1032) —
   * num incidente, a diferença entre 3 clientes e 5 mil é a informação toda.
   *
   * NÃO é chamado se o cliente abortar o download no meio: o generator para
   * de ser consumido e nunca chega ao fim. Isso é deliberado — quem registra
   * "começou a exportar" é o log de intenção, gravado antes de abrir o
   * stream; este aqui só confirma conclusão e volume.
   */
  onFinish?: (rowCount: number) => void,
): Readable {
  async function* generate() {
    // BOM p/ Excel pt-BR reconhecer UTF-8 — mesmo padrão do export
    // client-side legado (data-table.tsx downloadCsv).
    yield '﻿' + toCsvLine(columns.map((c) => c.header));

    let cursor: string | undefined;
    let rowCount = 0;
    for (;;) {
      const { items, nextCursor } = await fetchBatch(cursor, batchSize);
      for (const item of items) {
        rowCount += 1;
        yield toCsvLine(columns.map((c) => c.value(item)));
      }
      // lote menor que o pedido OU sem próximo cursor = última página
      if (items.length < batchSize || !nextCursor) break;
      cursor = nextCursor;
    }
    onFinish?.(rowCount);
  }

  return Readable.from(generate());
}
