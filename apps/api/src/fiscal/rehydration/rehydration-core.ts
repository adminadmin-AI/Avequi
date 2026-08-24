/**
 * Reidratação do histórico fiscal — núcleo PURO (sem I/O).
 *
 * Reconstrói os 11.081 FiscalDocument legados a partir do DB_Financeiro
 * (staging da carga de 18/06) e dos XMLs históricos, via legacyId dos itens.
 * O DB_Financeiro/XML é fonte de RECONSTRUÇÃO, não nova fonte de verdade:
 * o resultado é o próprio FiscalDocument/Item/ItemTax canônico pós-#1122.
 *
 * Decisões aprovadas (24/08/2026):
 *  N1 SAFE_AUTOMATIC — 9 pares intra-grupo, allowlist congelada + revalidação;
 *  N2 authorizedAt = NULL + pendência AUTH_TIME_UNVERIFIED sem XML confiável;
 *  N3 (chave "NFe" dos 6 Focus) e N4 (52 unitPrice) ficam FORA desta rodada.
 *
 * Regra de company SEMPRE derivada do documento (nunca mapa fixo de troca):
 *  EMITIDA  → company = CNPJ do emitente;
 *  RECEBIDA → company = CNPJ do destinatário.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type Direction = 'EMITIDA' | 'RECEBIDA';

export type DocState =
  | 'UNCHANGED'
  | 'WOULD_UPDATE'
  | 'UPDATED'
  | 'SKIPPED_UNRESOLVED'
  | 'CONFLICT'
  | 'FAILED'
  | 'FOCUS_IGNORED';

export type Pendency =
  | 'AUTH_TIME_UNVERIFIED'
  | 'SUPPLIER_MISSING'
  | 'XML_MISSING'
  | 'UNITPRICE_DIVERGENT'
  | 'INTRA_GROUP_PAIR';

export interface CompanyRow {
  id: string;
  name: string;
  cnpj: string | null;
}

export interface SupplierRow {
  id: string;
  companyId: string;
  cnpj: string | null;
}

export interface ErpItem {
  id: string;
  legacyId: string | null;
  nItem: number | null;
  productCode: string | null;
  unitPrice: string; // Decimal como string — comparação exata, sem float
  quantity: string;
  totalPrice: string;
  taxId: string | null;
  taxOrigemIcms: string | null;
  taxModalidadeBcIcms: string | null;
  taxCount: number;
}

export interface ErpDoc {
  id: string;
  companyId: string;
  type: string;
  status: string;
  focusRef: string | null;
  // Campos pré-Fase 1 sempre presentes:
  chave: string | null;
  number: number | null;
  series: number | null;
  authorizedAt: string | null;
  protocolNumber: string | null;
  // Campos da Fase 1 — undefined quando a migration ainda não chegou ao banco
  // (modo PRE_MIGRATION: dry-run permitido, commit proibido):
  direction?: Direction | null;
  issueDate?: string | null;
  issuerCnpj?: string | null;
  issuerName?: string | null;
  recipientCnpj?: string | null;
  naturezaOperacao?: string | null;
  tpNF?: number | null;
  supplierId?: string | null;
  totals?: Partial<Record<TotalField, string | null>>;
  xmlPresent?: boolean;
  items: ErpItem[];
}

/** Cabeçalho reconstruído pelo extractor a partir do DB_Financeiro + XML. */
export interface SourceHeader {
  chave: string;
  saida: {
    emitCnpj: string;
    destCnpj: string;
    destNome: string | null;
    numero: number;
    serie: number;
    /** data_emissao local (America/Sao_Paulo), 'YYYY-MM-DD HH:MM:SS' */
    emissaoLocal: string;
    natOp: string | null;
    tpNF: number | null;
    protocolo: string | null;
  } | null;
  entrada: {
    companyCnpj: string; // destinatário (a nossa empresa)
    emitCnpj: string;
    emitNome: string | null;
    numero: number;
    serie: number;
    emissaoLocal: string;
    natOp: string | null;
    tpNF: number | null;
    protocolo: string | null;
  } | null;
  totais: Partial<Record<TotalField, string>> | null;
  xml: {
    found: boolean;
    reliable: boolean; // 1 arquivo válido, chave interna confere, protNFe completo
    path: string | null;
    sha256: string | null;
    dhEmi: string | null; // com offset, direto do XML
    dhRecbto: string | null; // com offset, direto do XML
    nProt: string | null;
  };
}

export interface SourceItem {
  legacyId: string;
  chave: string;
  side: 'S' | 'E';
  nItem: number;
  cProd: string | null;
  descricao: string | null;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: string;
  valorUnitario: string;
  valorTotal: string;
  origemIcms: string | null;
  modalidadeBcIcms: string | null;
}

export const TOTAL_FIELDS = [
  'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI',
  'vICMS', 'vICMSUFDest', 'vFCPUFDest', 'vPIS', 'vCOFINS', 'vNF',
] as const;
export type TotalField = (typeof TOTAL_FIELDS)[number];

export interface AllowlistEntry {
  chave: string;
  nfNumber: number;
  docId: string;
  expectedDirection: Direction;
  expectedCompanyCnpj: string;
  keepItemId: string;
  keepLegacyId: string;
  dropItemId: string;
  dropLegacyId: string;
}

/** Estado-alvo de um documento, pronto para diff/execução. */
export interface TargetState {
  companyId: string;
  direction: Direction;
  issuerCnpj: string;
  issuerName: string | null;
  recipientCnpj: string | null;
  number: number;
  series: number;
  chave: string;
  issueDate: string; // ISO com offset
  authorizedAt: string | null; // ISO com offset; NULL = AUTH_TIME_UNVERIFIED
  protocolNumber: string | null;
  naturezaOperacao: string | null;
  tpNF: number | null;
  totals: Partial<Record<TotalField, string>>;
  supplierId: string | null;
  xmlPath: string | null; // XML confiável a gravar no commit (campo xml)
  itemNItems: Array<{ itemId: string; nItem: number }>;
  taxBackfills: Array<{
    taxId: string;
    origemIcms: string | null;
    modalidadeBcIcms: string | null;
  }>;
  dropMirrorItemId: string | null; // só via allowlist revalidada
  pendencies: Pendency[];
  unitPriceDivergences: Array<{ itemId: string; erp: string; origem: string }>;
  /** ERP == origem arredondada à precisão da coluna: não é divergência real. */
  unitPriceRepresentationOnly: number;
}

export interface DocResolution {
  docId: string;
  state: DocState;
  reasons: string[];
  target: TargetState | null;
}

// ─── Utilidades ──────────────────────────────────────────────────────────────

export function normalizeCnpj(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/**
 * data_emissao do DB_Financeiro é hora local do emitente (PR/America/Sao_Paulo,
 * sem DST desde 2019) → fixa offset -03:00. NUNCA usar para authorizedAt.
 */
export function saoPauloLocalToIso(local: string): string {
  const m = local.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
  if (!m) throw new Error(`data local inválida: ${local}`);
  return `${m[1]}T${m[2]}-03:00`;
}

/** Aceita apenas timestamp ISO com offset explícito (preserva o fuso do XML). */
export function assertHasOffset(iso: string, label: string): string {
  if (!/[+-]\d{2}:\d{2}$/.test(iso) && !/Z$/.test(iso)) {
    throw new Error(`${label} sem offset de fuso: ${iso}`);
  }
  return iso;
}

/**
 * Timestamp sem offset vindo do banco é UTC naive (convenção Prisma para
 * colunas `timestamp`): normaliza para ISO com 'Z' antes de comparar. Sem
 * isso, `Date.parse` interpreta o texto como hora LOCAL da máquina e cria uma
 * divergência artificial de fuso (ex.: 3h) na comparação de idempotência.
 */
export function normalizeDbTimestamp(v: string): string {
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/);
  return m ? `${m[1]}T${m[2]}Z` : v;
}

/**
 * Compara instantes independentemente do offset de exibição. Aceita string
 * (texto do banco/alvo) ou Date (Prisma devolve Date para colunas timestamp,
 * já interpretado como UTC naive pela convenção do client).
 */
export function sameInstant(a: string | Date | null, b: string | Date | null): boolean {
  if (a === null || b === null) return a === b;
  const toEpoch = (v: string | Date): number =>
    v instanceof Date ? v.getTime() : Date.parse(normalizeDbTimestamp(v));
  const ta = toEpoch(a);
  const tb = toEpoch(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return String(a) === String(b);
  return ta === tb;
}

/**
 * Arredonda um decimal em string para N casas (half-up), sem float — a coluna
 * unitPrice do ERP é Decimal(14,4) e a origem traz até 10 casas (vUnCom da
 * NF-e): diferença só de representação NÃO é divergência real.
 */
export function roundDecimalString(v: string, places: number): string {
  if (!/^-?\d+(\.\d+)?$/.test(v)) return v;
  const neg = v.startsWith('-');
  const [int, frac = ''] = v.replace(/^-/, '').split('.');
  if (frac.length <= places) return (neg ? '-' : '') + int + (frac ? '.' + frac : '');
  const keep = frac.slice(0, places);
  const roundUp = parseInt(frac[places], 10) >= 5;
  let digits = (int + keep).split('').map(Number);
  if (roundUp) {
    let i = digits.length - 1;
    while (i >= 0) {
      if (digits[i] === 9) digits[i--] = 0;
      else { digits[i]++; break; }
    }
    if (i < 0) digits = [1, ...digits];
  }
  const s = digits.join('');
  const intPart = s.slice(0, s.length - places) || '0';
  const fracPart = s.slice(s.length - places);
  return (neg ? '-' : '') + intPart + (places > 0 ? '.' + fracPart : '');
}

/** Compara decimais em string sem float (normaliza zeros à direita). */
export function sameDecimal(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined): string | null => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v);
    if (!/^-?\d+(\.\d+)?$/.test(s)) return s;
    let [int, frac = ''] = s.replace(/^-/, '').split('.');
    frac = frac.replace(/0+$/, '');
    int = int.replace(/^0+(?=\d)/, '');
    return (s.startsWith('-') ? '-' : '') + int + (frac ? '.' + frac : '');
  };
  return norm(a) === norm(b);
}

// ─── Classificação de proveniência ───────────────────────────────────────────

export type Provenance =
  | { kind: 'FOCUS' }
  | { kind: 'SAIDA' }
  | { kind: 'ENTRADA' }
  | { kind: 'MIXED' }
  | { kind: 'UNRESOLVED'; reason: string };

/**
 * Critério determinístico aprovado no pré-check:
 * histórico ⇔ focusRef IS NULL e existe item com legacyId 'item_%'.
 * Os 6 Focus têm focusRef e nenhum item legado — ficam FORA por regra.
 */
export function classifyProvenance(doc: Pick<ErpDoc, 'focusRef' | 'items'>): Provenance {
  if (doc.focusRef !== null) return { kind: 'FOCUS' };
  const legacy = doc.items.filter((i) => i.legacyId?.startsWith('item_'));
  if (legacy.length === 0) {
    return { kind: 'UNRESOLVED', reason: 'documento sem focusRef e sem item com legacyId' };
  }
  if (legacy.length !== doc.items.length) {
    return { kind: 'UNRESOLVED', reason: 'mistura de itens legados e não legados no mesmo documento' };
  }
  const hasS = legacy.some((i) => i.legacyId!.startsWith('item_saida_'));
  const hasE = legacy.some((i) => i.legacyId!.startsWith('item_entrada_'));
  if (hasS && hasE) return { kind: 'MIXED' };
  if (hasS) return { kind: 'SAIDA' };
  if (hasE) return { kind: 'ENTRADA' };
  return { kind: 'UNRESOLVED', reason: 'legacyId com prefixo desconhecido' };
}

// ─── Resolução de company (NUNCA mapa fixo) ──────────────────────────────────

export type CompanyResolution =
  | { kind: 'ONE'; company: CompanyRow }
  | { kind: 'NONE' }
  | { kind: 'AMBIGUOUS'; companies: CompanyRow[] };

export function resolveCompanyByCnpj(cnpj: string, companies: CompanyRow[]): CompanyResolution {
  const wanted = normalizeCnpj(cnpj);
  if (!wanted) return { kind: 'NONE' };
  const hits = companies.filter((c) => normalizeCnpj(c.cnpj) === wanted);
  if (hits.length === 1) return { kind: 'ONE', company: hits[0] };
  if (hits.length === 0) return { kind: 'NONE' };
  return { kind: 'AMBIGUOUS', companies: hits };
}

export type SupplierResolution =
  | { kind: 'ONE'; supplier: SupplierRow }
  | { kind: 'NONE' }
  | { kind: 'AMBIGUOUS' };

/** Match exato de CNPJ dentro da company correta. NÃO cria Supplier. */
export function resolveSupplier(
  issuerCnpj: string,
  companyId: string,
  suppliers: SupplierRow[],
): SupplierResolution {
  const wanted = normalizeCnpj(issuerCnpj);
  const hits = suppliers.filter(
    (s) => s.companyId === companyId && normalizeCnpj(s.cnpj) === wanted,
  );
  if (hits.length === 1) return { kind: 'ONE', supplier: hits[0] };
  if (hits.length === 0) return { kind: 'NONE' };
  return { kind: 'AMBIGUOUS' };
}

// ─── Datas ───────────────────────────────────────────────────────────────────

export interface DerivedDates {
  issueDate: string;
  authorizedAt: string | null;
  protocolNumber: string | null;
  pendencies: Pendency[];
}

/**
 * Política de datas (N2 aprovada):
 *  com XML confiável:  issueDate ← dhEmi; authorizedAt ← dhRecbto; nProt ← protNFe.
 *  sem XML confiável:  issueDate ← data_emissao como America/Sao_Paulo;
 *                      authorizedAt = NULL + AUTH_TIME_UNVERIFIED;
 *                      protocolo do DB_Financeiro (sem componente de fuso).
 * NUNCA dhEmi/emissão como authorizedAt.
 */
export function deriveDates(
  xml: SourceHeader['xml'],
  emissaoLocal: string,
  protocoloDb: string | null,
): DerivedDates {
  if (xml.reliable && xml.dhEmi && xml.dhRecbto && xml.nProt) {
    return {
      issueDate: assertHasOffset(xml.dhEmi, 'dhEmi'),
      authorizedAt: assertHasOffset(xml.dhRecbto, 'dhRecbto'),
      protocolNumber: xml.nProt,
      pendencies: [],
    };
  }
  const pendencies: Pendency[] = ['AUTH_TIME_UNVERIFIED'];
  if (!xml.found) pendencies.push('XML_MISSING');
  return {
    issueDate: saoPauloLocalToIso(emissaoLocal),
    authorizedAt: null,
    protocolNumber: protocoloDb,
    pendencies,
  };
}

// ─── Pares intra-grupo: revalidação da allowlist ─────────────────────────────

export interface MirrorValidationInput {
  doc: ErpDoc;
  entry: AllowlistEntry;
  partnerEntry: AllowlistEntry | undefined;
  partnerDocExists: boolean;
  sourceByLegacy: Map<string, SourceItem>;
}

/**
 * Um doc MIXED só é tratável se TODOS os invariantes auditados continuarem
 * valendo. Qualquer falha ⇒ CONFLICT (nunca DELETE genérico por padrão de
 * legacyId). A allowlist é a auditoria congelada de 24/08; a revalidação
 * garante que dado concorrente não a tornou obsoleta.
 */
export function validateMirrorPair(input: MirrorValidationInput): { ok: boolean; reasons: string[] } {
  const { doc, entry, partnerEntry, partnerDocExists, sourceByLegacy } = input;
  const reasons: string[] = [];

  if (!entry) return { ok: false, reasons: ['documento MIXED fora da allowlist auditada'] };
  if (doc.id !== entry.docId) reasons.push('docId difere da allowlist');
  if (!partnerEntry) reasons.push('par sem contraparte na allowlist');
  else if (partnerEntry.chave !== entry.chave) reasons.push('contraparte com chave diferente');
  else if (partnerEntry.expectedDirection === entry.expectedDirection) {
    reasons.push('par com a mesma direção nos dois lados');
  }
  if (!partnerDocExists) reasons.push('documento contraparte não existe mais no banco');

  if (doc.items.length !== 2) {
    reasons.push(`documento tem ${doc.items.length} itens; auditoria esperava 2`);
    return { ok: false, reasons };
  }
  const keep = doc.items.find((i) => i.id === entry.keepItemId);
  const drop = doc.items.find((i) => i.id === entry.dropItemId);
  if (!keep || keep.legacyId !== entry.keepLegacyId) reasons.push('item a manter não confere com a auditoria');
  if (!drop || drop.legacyId !== entry.dropLegacyId) reasons.push('item espelho não confere com a auditoria');

  // Direção/origem esperada: EMITIDA mantém item_saida_*, RECEBIDA item_entrada_*.
  const keepPrefix = entry.expectedDirection === 'EMITIDA' ? 'item_saida_' : 'item_entrada_';
  if (keep && !keep.legacyId?.startsWith(keepPrefix)) {
    reasons.push(`item a manter não é ${keepPrefix}* para direção ${entry.expectedDirection}`);
  }

  // Espelho exato: os dois itens de origem têm de continuar idênticos campo a campo.
  if (keep && drop) {
    const sKeep = keep.legacyId ? sourceByLegacy.get(keep.legacyId) : undefined;
    const sDrop = drop.legacyId ? sourceByLegacy.get(drop.legacyId) : undefined;
    if (!sKeep || !sDrop) reasons.push('item do par sem correspondente na origem');
    else {
      if (sKeep.chave !== entry.chave || sDrop.chave !== entry.chave) {
        reasons.push('chave da origem difere da auditada');
      }
      if (sKeep.nItem !== sDrop.nItem) reasons.push('nItem difere entre os lados do espelho');
      const mirrorFields: Array<keyof SourceItem> = ['cProd', 'descricao', 'ncm', 'cfop', 'unidade'];
      for (const f of mirrorFields) {
        if ((sKeep[f] ?? '') !== (sDrop[f] ?? '')) reasons.push(`espelho quebrado em ${f}`);
      }
      for (const f of ['quantidade', 'valorUnitario', 'valorTotal'] as const) {
        if (!sameDecimal(sKeep[f], sDrop[f])) reasons.push(`espelho quebrado em ${f}`);
      }
    }
    // FK: exatamente 1 tax por item (CASCADE cuida do resto) — nada além disso.
    if (keep.taxCount !== 1) reasons.push(`item a manter com ${keep.taxCount} taxes (esperado 1)`);
    if (drop.taxCount !== 1) reasons.push(`item espelho com ${drop.taxCount} taxes (esperado 1)`);
  }

  return { ok: reasons.length === 0, reasons };
}

// ─── Construção do estado-alvo ───────────────────────────────────────────────

export interface BuildContext {
  companies: CompanyRow[];
  suppliers: SupplierRow[];
  headersByChave: Map<string, SourceHeader>;
  sourceByLegacy: Map<string, SourceItem>;
  allowlistByDocId: Map<string, AllowlistEntry>;
  erpDocIds: Set<string>;
}

export function buildTarget(doc: ErpDoc, ctx: BuildContext): DocResolution {
  const prov = classifyProvenance(doc);
  if (prov.kind === 'FOCUS') {
    return { docId: doc.id, state: 'FOCUS_IGNORED', reasons: ['focusRef presente — fora da reidratação histórica'], target: null };
  }
  if (prov.kind === 'UNRESOLVED') {
    return { docId: doc.id, state: 'SKIPPED_UNRESOLVED', reasons: [prov.reason], target: null };
  }

  const pendencies: Pendency[] = [];
  let side: 'S' | 'E';
  let dropMirrorItemId: string | null = null;
  let activeItems = doc.items;

  if (prov.kind === 'MIXED') {
    const entry = ctx.allowlistByDocId.get(doc.id);
    if (!entry) {
      return { docId: doc.id, state: 'CONFLICT', reasons: ['documento MIXED fora da allowlist auditada'], target: null };
    }
    const partnerEntry = [...ctx.allowlistByDocId.values()].find(
      (e) => e.chave === entry.chave && e.docId !== entry.docId,
    );
    const check = validateMirrorPair({
      doc,
      entry,
      partnerEntry,
      partnerDocExists: partnerEntry ? ctx.erpDocIds.has(partnerEntry.docId) : false,
      sourceByLegacy: ctx.sourceByLegacy,
    });
    if (!check.ok) return { docId: doc.id, state: 'CONFLICT', reasons: check.reasons, target: null };
    side = entry.expectedDirection === 'EMITIDA' ? 'S' : 'E';
    dropMirrorItemId = entry.dropItemId;
    activeItems = doc.items.filter((i) => i.id === entry.keepItemId);
    pendencies.push('INTRA_GROUP_PAIR');
  } else {
    side = prov.kind === 'SAIDA' ? 'S' : 'E';
  }

  // Todos os itens ativos têm de resolver para a MESMA chave na origem.
  const chaves = new Set<string>();
  for (const it of activeItems) {
    const src = it.legacyId ? ctx.sourceByLegacy.get(it.legacyId) : undefined;
    if (!src) {
      return { docId: doc.id, state: 'SKIPPED_UNRESOLVED', reasons: [`item ${it.id} (${it.legacyId}) sem correspondente na origem`], target: null };
    }
    if (src.side !== side) {
      return { docId: doc.id, state: 'CONFLICT', reasons: [`item ${it.legacyId} com lado ${src.side} ≠ lado do documento ${side}`], target: null };
    }
    chaves.add(src.chave);
  }
  if (chaves.size !== 1) {
    return { docId: doc.id, state: 'CONFLICT', reasons: [`itens resolvem para ${chaves.size} chaves distintas`], target: null };
  }
  const chave = [...chaves][0];
  const header = ctx.headersByChave.get(chave);
  if (!header) {
    return { docId: doc.id, state: 'SKIPPED_UNRESOLVED', reasons: [`chave ${chave} sem cabeçalho na origem`], target: null };
  }

  const h = side === 'S' ? header.saida : header.entrada;
  if (!h) {
    return { docId: doc.id, state: 'CONFLICT', reasons: [`chave ${chave} sem cabeçalho do lado ${side} na origem`], target: null };
  }

  // Company SEMPRE derivada do documento.
  const direction: Direction = side === 'S' ? 'EMITIDA' : 'RECEBIDA';
  const issuerCnpj = side === 'S'
    ? normalizeCnpj((h as NonNullable<SourceHeader['saida']>).emitCnpj)
    : normalizeCnpj((h as NonNullable<SourceHeader['entrada']>).emitCnpj);
  const companyCnpj = side === 'S'
    ? issuerCnpj
    : normalizeCnpj((h as NonNullable<SourceHeader['entrada']>).companyCnpj);
  const recipientCnpj = side === 'S'
    ? normalizeCnpj((h as NonNullable<SourceHeader['saida']>).destCnpj) || null
    : companyCnpj;

  const co = resolveCompanyByCnpj(companyCnpj, ctx.companies);
  if (co.kind === 'NONE') {
    return { docId: doc.id, state: 'SKIPPED_UNRESOLVED', reasons: [`CNPJ ${companyCnpj} não corresponde a nenhuma Company`], target: null };
  }
  if (co.kind === 'AMBIGUOUS') {
    return { docId: doc.id, state: 'CONFLICT', reasons: [`CNPJ ${companyCnpj} corresponde a ${co.companies.length} companies`], target: null };
  }

  const dates = deriveDates(header.xml, h.emissaoLocal, h.protocolo);
  pendencies.push(...dates.pendencies);

  // Supplier: só RECEBIDA, só match exato, NUNCA criar.
  let supplierId: string | null = null;
  if (direction === 'RECEBIDA') {
    const sup = resolveSupplier(issuerCnpj, co.company.id, ctx.suppliers);
    if (sup.kind === 'ONE') supplierId = sup.supplier.id;
    else if (sup.kind === 'NONE') pendencies.push('SUPPLIER_MISSING');
    else {
      return { docId: doc.id, state: 'CONFLICT', reasons: [`mais de um Supplier com CNPJ ${issuerCnpj} na company ${co.company.name}`], target: null };
    }
  }

  // Itens: nItem da origem; unitPrice NUNCA alterado (N4) — só reportado.
  const itemNItems: TargetState['itemNItems'] = [];
  const taxBackfills: TargetState['taxBackfills'] = [];
  const unitPriceDivergences: TargetState['unitPriceDivergences'] = [];
  let unitPriceRepresentationOnly = 0;
  for (const it of activeItems) {
    const src = ctx.sourceByLegacy.get(it.legacyId!)!;
    itemNItems.push({ itemId: it.id, nItem: src.nItem });
    if (!sameDecimal(it.unitPrice, src.valorUnitario)) {
      // Divergência real só além da precisão da coluna (Decimal(14,4), half-up).
      if (sameDecimal(it.unitPrice, roundDecimalString(src.valorUnitario, 4))) {
        unitPriceRepresentationOnly++;
      } else {
        unitPriceDivergences.push({ itemId: it.id, erp: it.unitPrice, origem: src.valorUnitario });
      }
    }
    // Impostos: só backfill de campo hoje NULL — nunca sobrescrever valor existente.
    if (it.taxId) {
      const orig = it.taxOrigemIcms === null && src.origemIcms !== null ? src.origemIcms : null;
      const modBc = it.taxModalidadeBcIcms === null && src.modalidadeBcIcms !== null ? src.modalidadeBcIcms : null;
      if (orig !== null || modBc !== null) {
        taxBackfills.push({ taxId: it.taxId, origemIcms: orig, modalidadeBcIcms: modBc });
      }
    }
  }
  if (unitPriceDivergences.length > 0) pendencies.push('UNITPRICE_DIVERGENT');

  const issuerName = side === 'S' ? null : (h as NonNullable<SourceHeader['entrada']>).emitNome;

  return {
    docId: doc.id,
    state: 'WOULD_UPDATE', // provisório; diffDoc decide UNCHANGED
    reasons: [],
    target: {
      companyId: co.company.id,
      direction,
      issuerCnpj,
      issuerName,
      recipientCnpj,
      number: h.numero,
      series: h.serie,
      chave,
      issueDate: dates.issueDate,
      authorizedAt: dates.authorizedAt,
      protocolNumber: dates.protocolNumber,
      naturezaOperacao: h.natOp,
      tpNF: h.tpNF,
      totals: header.totais ?? {},
      supplierId,
      xmlPath: header.xml.reliable ? header.xml.path : null,
      itemNItems,
      taxBackfills,
      dropMirrorItemId,
      pendencies,
      unitPriceDivergences,
      unitPriceRepresentationOnly,
    },
  };
}

// ─── Diff / idempotência ─────────────────────────────────────────────────────

export interface FieldDiff {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Compara estado atual × alvo campo a campo (determinístico e auditável).
 * Reexecução pós-commit ⇒ zero diffs ⇒ UNCHANGED, sem UPDATE/DELETE novos.
 * Em modo PRE_MIGRATION os campos da Fase 1 vêm undefined ⇒ tudo WOULD_UPDATE.
 */
export function diffDoc(doc: ErpDoc, target: TargetState): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const push = (field: string, from: unknown, to: unknown) => diffs.push({ field, from, to });

  if (doc.companyId !== target.companyId) push('companyId', doc.companyId, target.companyId);
  if (doc.direction !== target.direction) push('direction', doc.direction, target.direction);
  if ((doc.issuerCnpj ?? null) !== target.issuerCnpj) push('issuerCnpj', doc.issuerCnpj, target.issuerCnpj);
  if ((doc.issuerName ?? null) !== (target.issuerName ?? null)) push('issuerName', doc.issuerName, target.issuerName);
  if ((doc.recipientCnpj ?? null) !== (target.recipientCnpj ?? null)) push('recipientCnpj', doc.recipientCnpj, target.recipientCnpj);
  if (doc.number !== target.number) push('number', doc.number, target.number);
  if (doc.series !== target.series) push('series', doc.series, target.series);
  if (doc.chave !== target.chave) push('chave', doc.chave, target.chave);
  if (!sameInstant(doc.issueDate ?? null, target.issueDate)) push('issueDate', doc.issueDate, target.issueDate);
  if (!sameInstant(doc.authorizedAt, target.authorizedAt)) push('authorizedAt', doc.authorizedAt, target.authorizedAt);
  if ((doc.protocolNumber ?? null) !== (target.protocolNumber ?? null)) push('protocolNumber', doc.protocolNumber, target.protocolNumber);
  if ((doc.naturezaOperacao ?? null) !== (target.naturezaOperacao ?? null)) push('naturezaOperacao', doc.naturezaOperacao, target.naturezaOperacao);
  if ((doc.tpNF ?? null) !== (target.tpNF ?? null)) push('tpNF', doc.tpNF, target.tpNF);
  if ((doc.supplierId ?? null) !== (target.supplierId ?? null)) push('supplierId', doc.supplierId, target.supplierId);
  for (const f of TOTAL_FIELDS) {
    const cur = doc.totals?.[f] ?? null;
    if (!sameDecimal(cur, target.totals[f] ?? null)) push(f, cur, target.totals[f] ?? null);
  }
  if (target.xmlPath !== null && doc.xmlPresent === false) push('xml', '(ausente)', '(xml histórico)');
  for (const { itemId, nItem } of target.itemNItems) {
    const it = doc.items.find((i) => i.id === itemId);
    if (it && it.nItem !== nItem) push(`item.${itemId}.nItem`, it?.nItem ?? null, nItem);
  }
  for (const tb of target.taxBackfills) {
    if (tb.origemIcms !== null) push(`tax.${tb.taxId}.origemIcms`, null, tb.origemIcms);
    if (tb.modalidadeBcIcms !== null) push(`tax.${tb.taxId}.modalidadeBcIcms`, null, tb.modalidadeBcIcms);
  }
  if (target.dropMirrorItemId !== null) {
    const still = doc.items.some((i) => i.id === target.dropMirrorItemId);
    if (still) push('items.mirror', target.dropMirrorItemId, '(WOULD_DELETE_MIRROR)');
  }
  return diffs;
}

// ─── Colisões nas uniques futuras ────────────────────────────────────────────

export interface FinalDocKey {
  docId: string;
  companyId: string;
  chave: string | null;
  issuerCnpj: string | null;
  series: number | null;
  number: number | null;
  type: string;
}

export function simulateUniqueCollisions(docs: FinalDocKey[]): {
  chaveCollisions: string[][];
  numberCollisions: string[][];
} {
  const byChave = new Map<string, string[]>();
  const byNumber = new Map<string, string[]>();
  for (const d of docs) {
    if (d.chave !== null) {
      const k = `${d.companyId}|${d.chave}`;
      byChave.set(k, [...(byChave.get(k) ?? []), d.docId]);
    }
    if (d.number !== null && d.issuerCnpj !== null) {
      const k = `${d.companyId}|${d.issuerCnpj}|${d.series}|${d.number}|${d.type}`;
      byNumber.set(k, [...(byNumber.get(k) ?? []), d.docId]);
    }
  }
  return {
    chaveCollisions: [...byChave.values()].filter((v) => v.length > 1),
    numberCollisions: [...byNumber.values()].filter((v) => v.length > 1),
  };
}

// ─── Safety assertions ───────────────────────────────────────────────────────

/** Universo auditado em 24/08/2026 — referência, não meta a forçar. */
export const EXPECTED_UNIVERSE = {
  totalDocs: 11087,
  historicDocs: 11081,
  focusDocs: 6,
  finalEmitida: 9828, // 9.813 + 9 pares + 6 Focus
  finalRecebida: 1259, // 1.250 + 9 pares
  totalItems: 14108,
  mirrorItems: 18,
  finalItems: 14090,
} as const;

export interface UniverseCounts {
  totalDocs: number;
  historicDocs: number;
  focusDocs: number;
  finalEmitida: number;
  finalRecebida: number;
  totalItems: number;
  mirrorItems: number;
  finalItems: number;
}

/**
 * Compara o banco atual + simulação com o universo auditado. Qualquer desvio
 * material ⇒ lista de violações; o commit real DEVE abortar antes de escrever.
 */
export function safetyAssertions(actual: UniverseCounts): string[] {
  const violations: string[] = [];
  for (const key of Object.keys(EXPECTED_UNIVERSE) as (keyof UniverseCounts)[]) {
    if (actual[key] !== EXPECTED_UNIVERSE[key]) {
      violations.push(`${key}: esperado ${EXPECTED_UNIVERSE[key]}, encontrado ${actual[key]}`);
    }
  }
  return violations;
}
