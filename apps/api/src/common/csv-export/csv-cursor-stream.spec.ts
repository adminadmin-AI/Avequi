import { createCsvCursorStream, type CursorBatch } from './csv-cursor-stream';

interface Row {
  id: string;
  name: string;
}

async function drain(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk.toString());
  }
  return chunks.join('');
}

describe('createCsvCursorStream (#1032)', () => {
  const columns = [
    { header: 'ID', value: (r: Row) => r.id },
    { header: 'Nome', value: (r: Row) => r.name },
  ];

  it('escreve BOM + cabeçalho + linhas separadas por ; e \\r\\n', async () => {
    const fetchBatch = jest.fn(async (): Promise<CursorBatch<Row>> => ({
      items: [{ id: '1', name: 'Alfa' }, { id: '2', name: 'Beta' }],
      nextCursor: undefined,
    }));

    const csv = await drain(createCsvCursorStream(columns, fetchBatch, 500));

    expect(csv).toBe('﻿ID;Nome\r\n1;Alfa\r\n2;Beta\r\n');
  });

  it('escapa aspas, ponto-e-vírgula e quebra de linha (RFC4180)', async () => {
    const fetchBatch = jest.fn(async (): Promise<CursorBatch<Row>> => ({
      items: [{ id: '1', name: 'Nome; "com" aspas\ne quebra' }],
      nextCursor: undefined,
    }));

    const csv = await drain(createCsvCursorStream(columns, fetchBatch, 500));

    expect(csv).toContain('"Nome; ""com"" aspas\ne quebra"');
  });

  it('trata null/undefined como célula vazia', async () => {
    const fetchBatch = jest.fn(async (): Promise<CursorBatch<Row>> => ({
      items: [{ id: '1', name: undefined as unknown as string }],
      nextCursor: undefined,
    }));

    const csv = await drain(createCsvCursorStream(columns, fetchBatch, 500));

    expect(csv).toBe('﻿ID;Nome\r\n1;\r\n');
  });

  it('percorre múltiplos lotes via cursor até o lote menor que batchSize', async () => {
    const pages: Row[][] = [
      [{ id: '1', name: 'A' }, { id: '2', name: 'B' }],
      [{ id: '3', name: 'C' }, { id: '4', name: 'D' }],
      [{ id: '5', name: 'E' }], // último lote — menor que batchSize=2
    ];
    let call = 0;
    const fetchBatch = jest.fn(async (cursor?: string): Promise<CursorBatch<Row>> => {
      const items = pages[call];
      call += 1;
      return { items, nextCursor: items[items.length - 1]?.id };
    });

    const csv = await drain(createCsvCursorStream(columns, fetchBatch, 2));

    expect(csv).toBe('﻿ID;Nome\r\n1;A\r\n2;B\r\n3;C\r\n4;D\r\n5;E\r\n');
    // exatamente 3 chamadas — nunca busca um lote extra vazio depois do último
    expect(fetchBatch).toHaveBeenCalledTimes(3);
  });

  it('cursor passado a cada chamada é o último id do lote anterior — nunca busca tudo de uma vez', async () => {
    const pages: Row[][] = [
      [{ id: '1', name: 'A' }, { id: '2', name: 'B' }],
      [{ id: '3', name: 'C' }],
    ];
    let call = 0;
    const cursorsSeen: Array<string | undefined> = [];
    const fetchBatch = jest.fn(async (cursor?: string): Promise<CursorBatch<Row>> => {
      cursorsSeen.push(cursor);
      const items = pages[call];
      call += 1;
      return { items, nextCursor: items[items.length - 1]?.id };
    });

    await drain(createCsvCursorStream(columns, fetchBatch, 2));

    expect(cursorsSeen).toEqual([undefined, '2']);
  });

  it('conjunto vazio: só BOM + cabeçalho, uma única chamada a fetchBatch', async () => {
    const fetchBatch = jest.fn(async (): Promise<CursorBatch<Row>> => ({ items: [], nextCursor: undefined }));

    const csv = await drain(createCsvCursorStream(columns, fetchBatch, 500));

    expect(csv).toBe('﻿ID;Nome\r\n');
    expect(fetchBatch).toHaveBeenCalledTimes(1);
  });

  it('memória limitada: nº de chamadas a fetchBatch é proporcional a total/batchSize, nunca 1 chamada com o conjunto inteiro', async () => {
    // Prova estrutural: se o util agregasse tudo antes de emitir, isto seria
    // UMA chamada trazendo os 1000 registros. O contrato é cursor + lote —
    // 1000 registros em lotes de 100 tem que gerar exatamente 10 chamadas,
    // cada uma limitada a `batchSize` itens (nunca o conjunto inteiro).
    // TOTAL não é múltiplo exato de BATCH de propósito: o último lote fica
    // menor que o teto e o loop para sem precisar de uma chamada extra só
    // para confirmar "acabou" (ver nota sobre o caso de múltiplo exato logo
    // abaixo, testado à parte).
    const TOTAL = 999;
    const BATCH = 100;
    const all: Row[] = Array.from({ length: TOTAL }, (_, i) => ({ id: String(i + 1), name: `Item ${i + 1}` }));
    const fetchBatch = jest.fn(async (cursor?: string): Promise<CursorBatch<Row>> => {
      const startIdx = cursor ? all.findIndex((r) => r.id === cursor) + 1 : 0;
      const items = all.slice(startIdx, startIdx + BATCH);
      return { items, nextCursor: items[items.length - 1]?.id };
    });

    const csv = await drain(createCsvCursorStream(columns, fetchBatch, BATCH));

    expect(fetchBatch).toHaveBeenCalledTimes(Math.ceil(TOTAL / BATCH));
    for (const [, batchSizeArg] of fetchBatch.mock.calls.map((c) => c)) {
      // segundo argumento (batchSize) é sempre o teto — nunca "traga tudo"
      expect(batchSizeArg).toBe(BATCH);
    }
    for (const call of fetchBatch.mock.results) {
      // nenhum lote resolvido individualmente excede o teto pedido
      expect((await call.value).items.length).toBeLessThanOrEqual(BATCH);
    }
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(TOTAL + 1); // +1 do cabeçalho
  });

  it('quando o total é múltiplo exato do lote, faz UMA chamada extra vazia para confirmar o fim (custo O(1), não O(n))', async () => {
    const pages: Row[][] = [
      [{ id: '1', name: 'A' }, { id: '2', name: 'B' }],
      [], // confirma que não há mais nada
    ];
    let call = 0;
    const fetchBatch = jest.fn(async (): Promise<CursorBatch<Row>> => {
      const items = pages[call];
      call += 1;
      return { items, nextCursor: items[items.length - 1]?.id };
    });

    await drain(createCsvCursorStream(columns, fetchBatch, 2));

    expect(fetchBatch).toHaveBeenCalledTimes(2); // 1 lote cheio + 1 confirmação vazia, nunca mais que isso
  });
});
