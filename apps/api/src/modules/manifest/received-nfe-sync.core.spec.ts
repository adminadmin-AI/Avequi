import {
  ReceivedNfePage,
  ReceivedNfeSummary,
  ReceivedNfeSyncState,
  SyncNoProgressError,
  initialState,
  normalizeReceivedItem,
  parseState,
  runIncrementalSync,
  serializeState,
  syncStateKey,
} from './received-nfe-sync.core';

const it_ = (n: number): ReceivedNfeSummary => ({
  chave: String(n).padStart(44, '0'), versao: n, numero: String(n), serie: '1', cnpjEmitente: '11111111000191',
  nomeEmitente: 'F', dataEmissao: '2026-08-01T00:00:00-03:00', valorTotal: '1.00', situacao: 'autorizado', manifestacao: null, raw: {},
});

/** Focus fake: universo de itens com versao crescente; página = até `pageSize` itens com versao > cursor. */
function focusFake(universe: () => ReceivedNfeSummary[], opts: { pageSize?: number; failOnCall?: number; headers?: boolean } = {}) {
  const pageSize = opts.pageSize ?? 100;
  let calls = 0;
  const fetchPage = async (cursor: number): Promise<ReceivedNfePage> => {
    calls++;
    if (opts.failOnCall === calls) throw new Error('HTTP 502 Bad Gateway');
    const all = universe().filter((i) => (i.versao ?? 0) > cursor).sort((a, b) => a.versao! - b.versao!);
    const items = all.slice(0, pageSize);
    const maxVersion = opts.headers === false ? null : items.length ? items[items.length - 1].versao : cursor;
    return { items, maxVersion, totalCount: all.length };
  };
  return { fetchPage, calls: () => calls };
}

/** Persistência fake por company: idempotente por chave. */
function store() {
  const saved = new Map<string, ReceivedNfeSummary>();
  const states: ReceivedNfeSyncState[] = [];
  return {
    saved,
    states,
    persistPage: async (items: ReceivedNfeSummary[]) => {
      let created = 0;
      for (const i of items) if (!saved.has(i.chave)) { saved.set(i.chave, i); created++; }
      return created;
    },
    saveState: async (s: ReceivedNfeSyncState) => { states.push(JSON.parse(JSON.stringify(s))); },
  };
}
const now = () => new Date('2026-08-25T12:00:00Z');

describe('runIncrementalSync — Focus-A', () => {
  it('primeira execução: várias páginas até esgotar; cursor termina no maior confirmado', async () => {
    const universe = Array.from({ length: 250 }, (_, i) => it_(i + 1));
    const focus = focusFake(() => universe);
    const db = store();
    const r = await runIncrementalSync(initialState('30284708000182'), { ...db, fetchPage: focus.fetchPage, now });
    expect(r).toMatchObject({ cursorFrom: 0, cursorTo: 250, pages: 3, seen: 250, synced: 250 });
    expect(focus.calls()).toBe(3); // 100 + 100 + 50 (última página < pageSize encerra)
    expect(db.saved.size).toBe(250);
    expect(r.state).toMatchObject({ lastRunStatus: 'OK', cursor: 250, lastRunNew: 250, totalCount: 250 });
    // cursor gravado após CADA página confirmada: 100 → 200 → 250
    expect(db.states.map((s) => s.cursor)).toEqual([0, 100, 200, 250, 250]);
  });

  it('segunda execução sem novidades: 0 novos, 1 chamada, cursor inalterado', async () => {
    const universe = Array.from({ length: 30 }, (_, i) => it_(i + 1));
    const db = store();
    const first = await runIncrementalSync(initialState('x'), { ...db, fetchPage: focusFake(() => universe).fetchPage, now });
    const focus2 = focusFake(() => universe);
    const second = await runIncrementalSync(first.state, { ...db, fetchPage: focus2.fetchPage, now });
    expect(second).toMatchObject({ cursorFrom: 30, cursorTo: 30, pages: 0, seen: 0, synced: 0 });
    expect(focus2.calls()).toBe(1);
    expect(second.state.lastRunStatus).toBe('OK');
  });

  it('novidade posterior: a próxima execução busca só o intervalo novo', async () => {
    const universe = Array.from({ length: 30 }, (_, i) => it_(i + 1));
    const db = store();
    const first = await runIncrementalSync(initialState('x'), { ...db, fetchPage: focusFake(() => universe).fetchPage, now });
    universe.push(it_(31), it_(32));
    const focus = focusFake(() => universe);
    const next = await runIncrementalSync(first.state, { ...db, fetchPage: focus.fetchPage, now });
    expect(next).toMatchObject({ cursorFrom: 30, cursorTo: 32, seen: 2, synced: 2 });
    expect(db.saved.size).toBe(32);
  });

  it('falha no meio: lança, estado FAILED, cursor fica na última página confirmada; reexecução retoma sem duplicar', async () => {
    const universe = Array.from({ length: 250 }, (_, i) => it_(i + 1));
    const db = store();
    const focus = focusFake(() => universe, { failOnCall: 2 });
    await expect(runIncrementalSync(initialState('x'), { ...db, fetchPage: focus.fetchPage, now })).rejects.toThrow('HTTP 502');
    const failed = db.states.at(-1)!;
    expect(failed).toMatchObject({ lastRunStatus: 'FAILED', cursor: 100, lastError: 'HTTP 502 Bad Gateway', lastRunNew: 100 });
    expect(db.saved.size).toBe(100);
    const resumed = await runIncrementalSync(failed, { ...db, fetchPage: focusFake(() => universe).fetchPage, now });
    expect(resumed).toMatchObject({ cursorFrom: 100, cursorTo: 250, seen: 150, synced: 150 });
    expect(db.saved.size).toBe(250); // nada perdido, nada duplicado
  });

  it('reexecução após sucesso é idempotente (persistência não recria)', async () => {
    const universe = Array.from({ length: 5 }, (_, i) => it_(i + 1));
    const db = store();
    await runIncrementalSync(initialState('x'), { ...db, fetchPage: focusFake(() => universe).fetchPage, now });
    // simula estado perdido (cursor 0) — reprocessa tudo, mas não cria de novo
    const r = await runIncrementalSync(initialState('x'), { ...db, fetchPage: focusFake(() => universe).fetchPage, now });
    expect(r).toMatchObject({ seen: 5, synced: 0, cursorTo: 5 });
    expect(db.saved.size).toBe(5);
  });

  it('duas companies são independentes (cursor, persistência e chamadas próprias)', async () => {
    const uA = Array.from({ length: 3 }, (_, i) => it_(i + 1));
    const uB = Array.from({ length: 120 }, (_, i) => it_(i + 1000));
    const dbA = store(); const dbB = store();
    const fA = focusFake(() => uA); const fB = focusFake(() => uB);
    const [a, b] = await Promise.all([
      runIncrementalSync(initialState('30284708000182'), { ...dbA, fetchPage: fA.fetchPage, now }),
      runIncrementalSync(initialState('46247069000115'), { ...dbB, fetchPage: fB.fetchPage, now }),
    ]);
    expect(a).toMatchObject({ cursorTo: 3, synced: 3, pages: 1 });
    expect(b).toMatchObject({ cursorTo: 1119, synced: 120, pages: 2 });
    expect(dbA.saved.size).toBe(3); expect(dbB.saved.size).toBe(120);
    expect(syncStateKey('30.284.708/0001-82')).not.toBe(syncStateKey('46247069000115'));
  });

  it('erro da Focus nunca vira lista vazia: fetchPage que lança propaga e não conta como "0 novos"', async () => {
    const db = store();
    const fetchPage = async () => { throw new Error('HTTP 401 Unauthorized'); };
    await expect(runIncrementalSync(initialState('x'), { ...db, fetchPage, now })).rejects.toThrow('401');
    expect(db.states.at(-1)).toMatchObject({ lastRunStatus: 'FAILED', lastError: 'HTTP 401 Unauthorized', cursor: 0 });
  });

  it('página sem avanço de cursor é erro (protege contra loop infinito)', async () => {
    const db = store();
    const fetchPage = async (): Promise<ReceivedNfePage> => ({ items: [it_(5)], maxVersion: 5, totalCount: 1 });
    await expect(runIncrementalSync({ ...initialState('x'), cursor: 5 }, { ...db, fetchPage, now })).rejects.toThrow(SyncNoProgressError);
  });

  it('sem cabeçalho X-Max-Version usa o maior `versao` dos itens', async () => {
    const universe = Array.from({ length: 7 }, (_, i) => it_(i + 1));
    const db = store();
    const r = await runIncrementalSync(initialState('x'), { ...db, fetchPage: focusFake(() => universe, { headers: false }).fetchPage, now });
    expect(r.cursorTo).toBe(7);
  });

  it('maxPages limita a execução sem erro; o resto fica para a próxima', async () => {
    const universe = Array.from({ length: 250 }, (_, i) => it_(i + 1));
    const db = store();
    const r = await runIncrementalSync(initialState('x'), { ...db, fetchPage: focusFake(() => universe).fetchPage, now, maxPages: 1 });
    expect(r).toMatchObject({ cursorTo: 100, pages: 1, synced: 100 });
    expect(r.state.lastRunStatus).toBe('OK');
  });
});

describe('estado e normalização', () => {
  it('parseState/serializeState: round-trip, default e corrompido sinalizado', () => {
    const s = { ...initialState('30284708000182'), cursor: 42, lastRunStatus: 'OK' as const };
    expect(parseState('30284708000182', serializeState(s))).toEqual(s);
    expect(parseState('x', null)).toMatchObject({ cursor: 0, lastRunStatus: 'NEVER' });
    expect(parseState('x', JSON.stringify({ cursor: -3 })).cursor).toBe(0);
    expect(parseState('x', '{nope')).toMatchObject({ cursor: 0, lastRunStatus: 'FAILED' });
  });

  it('normalizeReceivedItem: chave/versao/emitente; item sem chave válida é descartado', () => {
    const n = normalizeReceivedItem({ chave_nfe: '41260611111111000191550010000123451000012345', versao: '77', cnpj_emitente: '11.111.111/0001-91', nome_emitente: 'X', valor_total: '10.00', situacao: 'autorizado', manifestacao_destinatario: 'ciencia_da_operacao' });
    expect(n).toMatchObject({ chave: '41260611111111000191550010000123451000012345', versao: 77, cnpjEmitente: '11111111000191', manifestacao: 'ciencia_da_operacao' });
    expect(normalizeReceivedItem({ chave: '123' })).toBeNull();
  });
});
