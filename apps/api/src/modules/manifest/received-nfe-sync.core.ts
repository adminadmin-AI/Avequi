/**
 * Focus-A (#608) — sincronização INCREMENTAL de NF-e recebidas: núcleo PURO.
 *
 * A Focus lista as notas emitidas contra um CNPJ com um campo `versao`
 * (único por CNPJ, cresce a cada alteração da nota) e devolve no máximo 100
 * por requisição; `GET /v2/nfes_recebidas?cnpj=&versao=N` traz só as notas
 * com versão > N. Logo basta guardar UM cursor por company/CNPJ.
 *
 * Regras deste núcleo:
 *  - o cursor só avança DEPOIS que a página foi persistida (retomada segura:
 *    uma falha no meio deixa o cursor na última página confirmada; a próxima
 *    execução rebusca a partir dela — e a persistência é idempotente por
 *    (companyId, chave), então nada duplica);
 *  - paginação até esgotar: enquanto a página vier cheia (pageSize itens);
 *  - erro de rede/API NUNCA vira "0 notas": `fetchPage` lança, o núcleo marca
 *    o estado como FAILED (com a mensagem) e relança;
 *  - sem progresso (página não vazia cujo maxVersion não supera o cursor) é
 *    erro, não loop infinito;
 *  - isolamento: o estado é da company; nada aqui conhece CNPJ fixo.
 *
 * Fora daqui (Focus-B/C): ciência automática, download do XML, importação em
 * FiscalDocument pelo parser da #1128, retry operacional e alertas.
 */

export interface ReceivedNfeSummary {
  chave: string;
  versao: number | null;
  numero: string | null;
  serie: string | null;
  cnpjEmitente: string | null;
  nomeEmitente: string | null;
  dataEmissao: string | null;
  valorTotal: string | number | null;
  situacao: string | null;
  manifestacao: string | null;
  raw: Record<string, unknown>;
}

export interface ReceivedNfePage {
  items: ReceivedNfeSummary[];
  /** Cabeçalho X-Max-Version da Focus (null se ausente → usa max(versao) dos itens). */
  maxVersion: number | null;
  /** Cabeçalho X-Total-Count (informativo). */
  totalCount: number | null;
}

export type SyncRunStatus = 'OK' | 'FAILED' | 'RUNNING' | 'NEVER';

/** Estado persistido por company/CNPJ (JSON em SystemParameter). */
export interface ReceivedNfeSyncState {
  cnpj: string;
  cursor: number; // maior `versao` CONFIRMADA (persistida)
  lastRunStatus: SyncRunStatus;
  lastSyncAt: string | null; // início da última execução
  lastSuccessAt: string | null;
  lastError: string | null;
  lastRunSeen: number; // itens devolvidos pela Focus na última execução
  lastRunNew: number; // itens novos persistidos na última execução
  lastRunPages: number;
  totalCount: number | null; // X-Total-Count visto no início da última execução (pendentes acima do cursor)
}

export function initialState(cnpj: string): ReceivedNfeSyncState {
  return {
    cnpj, cursor: 0, lastRunStatus: 'NEVER', lastSyncAt: null, lastSuccessAt: null,
    lastError: null, lastRunSeen: 0, lastRunNew: 0, lastRunPages: 0, totalCount: null,
  };
}

/** Chave genérica: provider.resource.sync:<identificador externo>. */
export function syncStateKey(cnpj: string): string {
  return `focus.nfe_recebidas.sync:${cnpj.replace(/\D/g, '')}`;
}

export function parseState(cnpj: string, raw: string | null | undefined): ReceivedNfeSyncState {
  if (!raw) return initialState(cnpj);
  try {
    const p = JSON.parse(raw) as Partial<ReceivedNfeSyncState>;
    const cursor = typeof p.cursor === 'number' && Number.isFinite(p.cursor) && p.cursor >= 0 ? p.cursor : 0;
    return { ...initialState(cnpj), ...p, cnpj, cursor };
  } catch {
    // estado corrompido não pode virar "recomeçar do zero" em silêncio: sinaliza
    return { ...initialState(cnpj), lastRunStatus: 'FAILED', lastError: 'estado persistido ilegível — cursor reiniciado em 0' };
  }
}

export function serializeState(s: ReceivedNfeSyncState): string {
  return JSON.stringify(s);
}

/** Normaliza um item bruto da Focus (nomes conforme a API v2). */
export function normalizeReceivedItem(raw: Record<string, unknown>): ReceivedNfeSummary | null {
  const chave = String(raw.chave_nfe ?? raw.chave ?? '').replace(/\D/g, '');
  if (chave.length !== 44) return null;
  const v = raw.versao;
  const versao = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? parseInt(v, 10) : null;
  const str = (x: unknown): string | null => (x === null || x === undefined || x === '' ? null : String(x));
  return {
    chave,
    versao,
    numero: str(raw.numero),
    serie: str(raw.serie),
    cnpjEmitente: str(raw.cnpj_emitente)?.replace(/\D/g, '') ?? null,
    nomeEmitente: str(raw.nome_emitente),
    dataEmissao: str(raw.data_emissao),
    valorTotal: (raw.valor_total as string | number | null | undefined) ?? null,
    situacao: str(raw.situacao),
    manifestacao: str(raw.manifestacao_destinatario ?? raw.manifestacao),
    raw,
  };
}

export class SyncNoProgressError extends Error {
  constructor(cursor: number, maxVersion: number | null) {
    super(`página não vazia sem avanço de cursor (cursor=${cursor}, maxVersion=${maxVersion}) — abortado para não entrar em loop`);
    this.name = 'SyncNoProgressError';
  }
}

export interface SyncDeps {
  /** Busca uma página com versao > cursor. DEVE lançar em erro de rede/API. */
  fetchPage: (cursor: number) => Promise<ReceivedNfePage>;
  /** Persiste os itens da página de forma idempotente; devolve quantos eram novos. */
  persistPage: (items: ReceivedNfeSummary[]) => Promise<number>;
  /** Grava o estado (chamado ao iniciar, após CADA página confirmada e ao terminar). */
  saveState: (state: ReceivedNfeSyncState) => Promise<void>;
  now: () => Date;
  pageSize?: number; // Focus: 100
  maxPages?: number; // teto de segurança por execução
}

export interface SyncResult {
  cursorFrom: number;
  cursorTo: number;
  pages: number;
  seen: number;
  synced: number;
  state: ReceivedNfeSyncState;
}

/**
 * Executa uma sincronização incremental completa para UMA company.
 * Lança em falha (depois de gravar o estado FAILED com o cursor confirmado).
 */
export async function runIncrementalSync(start: ReceivedNfeSyncState, deps: SyncDeps): Promise<SyncResult> {
  const pageSize = deps.pageSize ?? 100;
  const maxPages = deps.maxPages ?? 500;
  const cursorFrom = start.cursor;
  const state: ReceivedNfeSyncState = {
    ...start,
    lastRunStatus: 'RUNNING',
    lastSyncAt: deps.now().toISOString(),
    lastError: null,
    lastRunSeen: 0,
    lastRunNew: 0,
    lastRunPages: 0,
  };
  await deps.saveState(state);

  try {
    for (;;) {
      if (state.lastRunPages >= maxPages) {
        // não é erro: o restante fica para a próxima execução; cursor já confirmado
        break;
      }
      const page = await deps.fetchPage(state.cursor);
      // X-Total-Count da PRIMEIRA página da execução = quantas notas havia acima do cursor inicial
      if (page.totalCount !== null && state.lastRunPages === 0) state.totalCount = page.totalCount;
      if (page.items.length === 0) break;

      const itemMax = page.items.reduce<number | null>((m, it) => (it.versao !== null && (m === null || it.versao > m) ? it.versao : m), null);
      const newCursor = page.maxVersion ?? itemMax;
      if (newCursor === null || newCursor <= state.cursor) throw new SyncNoProgressError(state.cursor, newCursor);

      const created = await deps.persistPage(page.items);
      // cursor avança SÓ depois da persistência da página
      state.cursor = newCursor;
      state.lastRunPages += 1;
      state.lastRunSeen += page.items.length;
      state.lastRunNew += created;
      await deps.saveState(state);

      if (page.items.length < pageSize) break;
    }
    state.lastRunStatus = 'OK';
    state.lastSuccessAt = deps.now().toISOString();
    await deps.saveState(state);
    return { cursorFrom, cursorTo: state.cursor, pages: state.lastRunPages, seen: state.lastRunSeen, synced: state.lastRunNew, state };
  } catch (err) {
    state.lastRunStatus = 'FAILED';
    state.lastError = (err as Error).message;
    await deps.saveState(state); // cursor = última página confirmada
    throw err;
  }
}
