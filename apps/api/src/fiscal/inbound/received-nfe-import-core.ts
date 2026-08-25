/**
 * Importação canônica de NF-e RECEBIDA a partir do XML — núcleo PURO (sem I/O).
 *
 * Fonte canônica é o próprio FiscalDocument / FiscalDocumentItem /
 * FiscalDocumentItemTax (pós-#1122). NÃO existe tabela fiscal paralela.
 *
 * Este núcleo é o mesmo para as duas origens de XML:
 *   - pasta local (export do Qive)  → scripts/import-received-nfe-xml.ts
 *   - Focus NF-e (#608, PR Focus-B) → mesmo parser, mesmo plano, mesma escrita
 * Só a ORIGEM do texto muda; o que entra aqui é sempre `ParsedNfeDocument`.
 *
 * Regras herdadas da reidratação (rehydration-core):
 *   - company SEMPRE derivada do documento: RECEBIDA → company = destinatário;
 *   - Supplier: match exato por CNPJ dentro da company; NUNCA cria;
 *   - datas: issueDate ← dhEmi, authorizedAt ← protNFe/dhRecbto (com offset);
 *   - decimais como string (sem float); idempotência por comparação campo a
 *     campo, sem tabela de status.
 *
 * Estados de um XML:
 *   INSERT     documento não existe em (companyId, chave) → cria doc+itens+impostos
 *   UNCHANGED  existe e nada legítimo a atualizar
 *   UPDATE     existe; só mudanças LEGÍTIMAS (supplierId nulo→resolvido, XML
 *              ausente→preenchido, cancelamento por evento registrado)
 *   CONFLICT   existe mas diverge em fato fiscal (emitente, número/série,
 *              total, itens) ou Supplier ambíguo → nunca escreve
 *   SKIPPED    não é NF-e recebida da company (NFC-e, homologação, destinatário
 *              não é company do ERP, evento sem nota) → nada a fazer
 *   INVALID    XML malformado, sem autorização, chave inconsistente
 */
import {
  ParsedEvento,
  ParsedNfe,
  ParsedNfeDocument,
  NfeItem,
  NFE_TOTAL_FIELDS,
  NfeTotalField,
  TP_EVENTO,
} from '../nfe-xml/nfe-proc.parser';
import {
  CompanyRow,
  SupplierRow,
  assertHasOffset,
  normalizeCnpj,
  resolveCompanyByCnpj,
  resolveSupplier,
  roundDecimalString,
  sameDecimal,
} from '../rehydration/rehydration-core';

// ─── Tipos de entrada (estado atual do ERP) ──────────────────────────────────

export interface ExistingItem {
  id: string;
  nItem: number | null;
  productCode: string | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
}

export interface ExistingDoc {
  id: string;
  companyId: string;
  direction: 'EMITIDA' | 'RECEBIDA';
  status: string;
  type: string;
  chave: string;
  issuerCnpj: string | null;
  number: number | null;
  series: number | null;
  vNF: string | null;
  supplierId: string | null;
  xmlPresent: boolean;
  cancelledAt: string | null;
  items: ExistingItem[];
}

export interface ImportContext {
  companies: CompanyRow[];
  suppliers: SupplierRow[];
  /** chave → docs existentes com essa chave (pode haver 1 por company do grupo). */
  existingByChave: Map<string, ExistingDoc[]>;
  /** chave → eventos (procEventoNFe) conhecidos para a chave. */
  eventsByChave: Map<string, ParsedEvento[]>;
}

// ─── Tipos de saída (plano) ──────────────────────────────────────────────────

export type ImportState = 'INSERT' | 'UNCHANGED' | 'UPDATE' | 'CONFLICT' | 'SKIPPED' | 'INVALID';

export type ImportPendency =
  | 'SUPPLIER_MISSING' // NF-e importada sem supplierId — religar depois (nunca cria Supplier)
  | 'INTRA_GROUP' // emitente também é company do ERP (par intra-grupo)
  | 'CCE_NOT_PERSISTED' // há carta de correção, mas FiscalCorrection não modela dhEvento — arquivo preservado
  | 'MANIFEST_EVENT_IGNORED' // evento de manifestação (210xxx) não é representado nesta etapa
  | 'CANCEL_EVENT_UNREGISTERED'; // evento 110111 sem cStat 135/155 — não cancela

export interface TargetTax {
  origemIcms: string | null;
  modalidadeBcIcms: string | null;
  cstIcms: string | null;
  baseIcms: string | null;
  aliquotaIcms: string | null;
  valorIcms: string | null;
  cstIpi: string | null;
  baseIpi: string | null;
  aliquotaIpi: string | null;
  valorIpi: string | null;
  cstPis: string | null;
  basePis: string | null;
  aliquotaPis: string | null;
  valorPis: string | null;
  cstCofins: string | null;
  baseCofins: string | null;
  aliquotaCofins: string | null;
  valorCofins: string | null;
  difalBase: string | null;
  difalAliqInterna: string | null;
  difalAliqInterest: string | null;
  difalValor: string | null;
  difalFcpAliquota: string | null;
  difalFcpValor: string | null;
  cClassTrib: string | null;
  cstCbs: string | null;
  baseCbs: string | null;
  aliquotaCbs: string | null;
  valorCbs: string | null;
  cstIbsUf: string | null;
  baseIbsUf: string | null;
  aliquotaIbsUf: string | null;
  valorIbsUf: string | null;
  cstIbsMun: string | null;
  baseIbsMun: string | null;
  aliquotaIbsMun: string | null;
  valorIbsMun: string | null;
}

export interface TargetItem {
  nItem: number;
  productCode: string | null;
  productName: string;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  unit: string | null;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  tax: TargetTax | null;
}

export type Finalidade = 'NORMAL' | 'COMPLEMENTAR' | 'AJUSTE' | 'DEVOLUCAO';

export interface TargetDoc {
  companyId: string;
  type: 'NFE';
  direction: 'RECEBIDA';
  status: 'AUTHORIZED' | 'CANCELLED';
  finalidade: Finalidade;
  chave: string;
  number: number;
  series: number;
  issueDate: string; // ISO com offset (dhEmi)
  authorizedAt: string; // ISO com offset (dhRecbto)
  protocolNumber: string;
  issuerCnpj: string;
  issuerName: string | null;
  recipientCnpj: string;
  naturezaOperacao: string | null;
  tpNF: number | null;
  supplierId: string | null;
  totals: Partial<Record<NfeTotalField, string>>;
  infCpl: string | null;
  cancelledAt: string | null;
  cancellationJustification: string | null;
  items: TargetItem[];
}

/** Mudanças LEGÍTIMAS sobre um documento existente — nada além destas. */
export interface LegitUpdate {
  docId: string;
  supplierId?: string; // null → resolvido
  xml?: true; // ausente → preenchido com o XML do arquivo
  cancel?: { cancelledAt: string; justification: string | null }; // AUTHORIZED → CANCELLED por evento registrado
}

export interface ImportPlan {
  chave: string;
  state: ImportState;
  reasons: string[];
  pendencies: ImportPendency[];
  companyId: string | null;
  /** Preenchido em INSERT (documento completo) e, para referência, em UNCHANGED/UPDATE. */
  target: TargetDoc | null;
  /** Preenchido só em UPDATE. */
  update: LegitUpdate | null;
  existingDocId: string | null;
}

// ─── Mapeamento XML → schema ─────────────────────────────────────────────────

const FINALIDADE: Record<string, Finalidade> = { '1': 'NORMAL', '2': 'COMPLEMENTAR', '3': 'AJUSTE', '4': 'DEVOLUCAO' };

/** Só o que o schema FiscalDocumentItemTax modela — sem inventar coluna. */
export function mapItemTax(it: NfeItem): TargetTax | null {
  if (!it.icms && !it.ipi && !it.pis && !it.cofins && !it.difal && !it.ibsCbs) return null;
  return {
    origemIcms: it.icms?.orig ?? null,
    modalidadeBcIcms: it.icms?.modBC ?? null,
    cstIcms: it.icms?.cst ?? it.icms?.csosn ?? null, // CST (normal) ou CSOSN (Simples) — mesma coluna, como no histórico
    baseIcms: it.icms?.vBC ?? null,
    aliquotaIcms: it.icms?.pICMS ?? null,
    valorIcms: it.icms?.vICMS ?? null,
    cstIpi: it.ipi?.cst ?? null,
    baseIpi: it.ipi?.vBC ?? null,
    aliquotaIpi: it.ipi?.aliquota ?? null,
    valorIpi: it.ipi?.valor ?? null,
    cstPis: it.pis?.cst ?? null,
    basePis: it.pis?.vBC ?? null,
    aliquotaPis: it.pis?.aliquota ?? null,
    valorPis: it.pis?.valor ?? null,
    cstCofins: it.cofins?.cst ?? null,
    baseCofins: it.cofins?.vBC ?? null,
    aliquotaCofins: it.cofins?.aliquota ?? null,
    valorCofins: it.cofins?.valor ?? null,
    difalBase: it.difal?.vBCUFDest ?? null,
    difalAliqInterna: it.difal?.pICMSUFDest ?? null,
    difalAliqInterest: it.difal?.pICMSInter ?? null,
    difalValor: it.difal?.vICMSUFDest ?? null,
    difalFcpAliquota: it.difal?.pFCPUFDest ?? null,
    difalFcpValor: it.difal?.vFCPUFDest ?? null,
    cClassTrib: it.ibsCbs?.cClassTrib ?? null,
    cstCbs: it.ibsCbs?.cst ?? null,
    baseCbs: it.ibsCbs?.vBC ?? null,
    aliquotaCbs: it.ibsCbs?.pCBS ?? null,
    valorCbs: it.ibsCbs?.vCBS ?? null,
    cstIbsUf: it.ibsCbs?.cst ?? null,
    baseIbsUf: it.ibsCbs?.vBC ?? null,
    aliquotaIbsUf: it.ibsCbs?.pIBSUF ?? null,
    valorIbsUf: it.ibsCbs?.vIBSUF ?? null,
    cstIbsMun: it.ibsCbs?.cst ?? null,
    baseIbsMun: it.ibsCbs?.vBC ?? null,
    aliquotaIbsMun: it.ibsCbs?.pIBSMun ?? null,
    valorIbsMun: it.ibsCbs?.vIBSMun ?? null,
  };
}

export function mapItem(it: NfeItem): TargetItem {
  return {
    nItem: it.nItem,
    productCode: it.cProd,
    productName: it.xProd,
    ncm: it.ncm,
    cest: it.cest,
    cfop: it.cfop,
    unit: it.uCom,
    quantity: it.qCom,
    unitPrice: it.vUnCom,
    totalPrice: it.vProd,
    tax: mapItemTax(it),
  };
}

// ─── Eventos ─────────────────────────────────────────────────────────────────

const EVENT_REGISTERED = new Set(['135', '155']); // 135 vinculado à NF-e; 155 vinculado fora de prazo

export interface EventSummary {
  cancel: { cancelledAt: string; justification: string | null } | null;
  pendencies: ImportPendency[];
  cceCount: number;
}

/** Só o cancelamento REGISTRADO (cStat 135/155) muda o documento. */
export function summarizeEvents(events: ParsedEvento[]): EventSummary {
  const pend = new Set<ImportPendency>();
  let cancel: EventSummary['cancel'] = null;
  let cceCount = 0;
  for (const ev of events) {
    if (ev.tpEvento === TP_EVENTO.CANCELAMENTO) {
      const registered = ev.ret?.cStat !== null && ev.ret?.cStat !== undefined && EVENT_REGISTERED.has(ev.ret.cStat);
      if (registered && ev.dhEvento) {
        cancel = { cancelledAt: assertHasOffset(ev.dhEvento, 'dhEvento'), justification: ev.xJust };
      } else {
        pend.add('CANCEL_EVENT_UNREGISTERED');
      }
    } else if (ev.tpEvento === TP_EVENTO.CARTA_CORRECAO) {
      cceCount++;
      pend.add('CCE_NOT_PERSISTED');
    } else if (ev.tpEvento.startsWith('21')) {
      pend.add('MANIFEST_EVENT_IGNORED');
    }
  }
  return { cancel, pendencies: [...pend], cceCount };
}

// ─── Construção do alvo ──────────────────────────────────────────────────────

const AUTHORIZED_CSTAT = new Set(['100', '150']); // 150 = autorizada fora de prazo

export function buildTargetFromNfe(nfe: ParsedNfe, ctx: ImportContext): ImportPlan {
  const base = (state: ImportState, reasons: string[]): ImportPlan => ({
    chave: nfe.chave, state, reasons, pendencies: [], companyId: null, target: null, update: null, existingDocId: null,
  });

  if (!nfe.chaveConsistente) return base('INVALID', ['chave do Id difere de protNFe/chNFe']);
  if (!nfe.prot) return base('INVALID', ['sem <protNFe> — XML não é de nota autorizada (nfeProc)']);
  if (!nfe.prot.cStat || !AUTHORIZED_CSTAT.has(nfe.prot.cStat)) {
    return base('INVALID', [`cStat ${nfe.prot.cStat ?? '?'} — não autorizada (${nfe.prot.xMotivo ?? 'sem motivo'})`]);
  }
  if (!nfe.prot.dhRecbto || !nfe.prot.nProt) return base('INVALID', ['protNFe sem dhRecbto/nProt']);
  if (nfe.mod !== '55') return base('SKIPPED', [`modelo ${nfe.mod ?? '?'} — só NF-e (55) entra como RECEBIDA`]);
  if (nfe.tpAmb !== '1' || nfe.prot.tpAmb !== '1') return base('SKIPPED', ['ambiente de homologação (tpAmb ≠ 1)']);
  if (nfe.serie === null || nfe.nNF === null || !nfe.dhEmi) return base('INVALID', ['ide sem serie/nNF/dhEmi']);
  if (!nfe.emit.cnpj) return base('SKIPPED', ['emitente sem CNPJ (pessoa física) — fora do escopo desta etapa']);
  if (!nfe.dest.cnpj) return base('SKIPPED', ['destinatário sem CNPJ — não é nota contra uma company']);

  // Company = DESTINATÁRIO (RECEBIDA). Nunca mapa fixo.
  const co = resolveCompanyByCnpj(nfe.dest.cnpj, ctx.companies);
  if (co.kind === 'NONE') return base('SKIPPED', [`destinatário ${nfe.dest.cnpj} não é company do ERP`]);
  if (co.kind === 'AMBIGUOUS') return base('CONFLICT', [`CNPJ ${nfe.dest.cnpj} corresponde a ${co.companies.length} companies`]);
  const companyId = co.company.id;

  const pendencies: ImportPendency[] = [];
  const issuerCnpj = normalizeCnpj(nfe.emit.cnpj);
  if (resolveCompanyByCnpj(issuerCnpj, ctx.companies).kind === 'ONE') pendencies.push('INTRA_GROUP');

  // Supplier: exato, na company; NUNCA cria.
  let supplierId: string | null = null;
  const sup = resolveSupplier(issuerCnpj, companyId, ctx.suppliers);
  if (sup.kind === 'ONE') supplierId = sup.supplier.id;
  else if (sup.kind === 'NONE') pendencies.push('SUPPLIER_MISSING');
  else return { ...base('CONFLICT', [`mais de um Supplier com CNPJ ${issuerCnpj} na company ${co.company.name}`]), companyId };

  const ev = summarizeEvents(ctx.eventsByChave.get(nfe.chave) ?? []);
  pendencies.push(...ev.pendencies);

  const totals: Partial<Record<NfeTotalField, string>> = {};
  for (const f of NFE_TOTAL_FIELDS) if (nfe.totals[f] !== undefined) totals[f] = nfe.totals[f];

  const target: TargetDoc = {
    companyId,
    type: 'NFE',
    direction: 'RECEBIDA',
    status: ev.cancel ? 'CANCELLED' : 'AUTHORIZED',
    finalidade: FINALIDADE[nfe.finNFe ?? '1'] ?? 'NORMAL',
    chave: nfe.chave,
    number: nfe.nNF,
    series: nfe.serie,
    issueDate: assertHasOffset(nfe.dhEmi, 'dhEmi'),
    authorizedAt: assertHasOffset(nfe.prot.dhRecbto, 'dhRecbto'),
    protocolNumber: nfe.prot.nProt,
    issuerCnpj,
    issuerName: nfe.emit.xNome,
    recipientCnpj: normalizeCnpj(nfe.dest.cnpj),
    naturezaOperacao: nfe.natOp,
    tpNF: nfe.tpNF,
    supplierId,
    totals,
    infCpl: nfe.infCpl,
    cancelledAt: ev.cancel?.cancelledAt ?? null,
    cancellationJustification: ev.cancel?.justification ?? null,
    items: nfe.items.map(mapItem),
  };

  // ── existe em (companyId, chave)? ──
  const existing = (ctx.existingByChave.get(nfe.chave) ?? []).filter((d) => d.companyId === companyId);
  if (existing.length > 1) {
    return { ...base('CONFLICT', [`${existing.length} documentos com a mesma chave na company`]), companyId, pendencies, target };
  }
  if (existing.length === 0) {
    return { ...base('INSERT', []), companyId, pendencies, target };
  }

  const doc = existing[0];
  const conflicts = compareExisting(doc, target);
  if (conflicts.length > 0) {
    return { ...base('CONFLICT', conflicts), companyId, pendencies, target, existingDocId: doc.id };
  }

  // Só mudanças legítimas; qualquer outra diferença é CONFLICT acima.
  const update: LegitUpdate = { docId: doc.id };
  const reasons: string[] = [];
  if (doc.supplierId === null && supplierId !== null) {
    update.supplierId = supplierId;
    reasons.push('supplierId: null → resolvido');
  }
  if (!doc.xmlPresent) {
    update.xml = true;
    reasons.push('xml: ausente → arquivo');
  }
  if (ev.cancel && doc.status !== 'CANCELLED') {
    update.cancel = ev.cancel;
    reasons.push(`status: ${doc.status} → CANCELLED (evento 110111 registrado)`);
  }
  const hasChange = update.supplierId !== undefined || update.xml !== undefined || update.cancel !== undefined;
  return {
    ...base(hasChange ? 'UPDATE' : 'UNCHANGED', reasons),
    companyId,
    pendencies,
    target,
    update: hasChange ? update : null,
    existingDocId: doc.id,
  };
}

/**
 * Fatos fiscais que NÃO podem divergir entre o documento existente e o XML.
 * Divergência aqui significa que o XML não é a mesma nota (ou o registro foi
 * corrompido) — nunca "corrigimos" por cima: CONFLICT, para um humano olhar.
 * Itens/impostos existentes NUNCA são reescritos por este importador.
 */
export function compareExisting(doc: ExistingDoc, target: TargetDoc): string[] {
  const c: string[] = [];
  if (doc.direction !== 'RECEBIDA') c.push(`documento existente é ${doc.direction}, XML é nota recebida`);
  if (doc.type !== 'NFE') c.push(`type existente ${doc.type} ≠ NFE`);
  if ((doc.issuerCnpj ?? '') !== target.issuerCnpj) c.push(`issuerCnpj ${doc.issuerCnpj} ≠ ${target.issuerCnpj}`);
  if (doc.number !== target.number) c.push(`number ${doc.number} ≠ ${target.number}`);
  if (doc.series !== target.series) c.push(`series ${doc.series} ≠ ${target.series}`);
  if (doc.vNF !== null && target.totals.vNF !== undefined && !sameDecimal(doc.vNF, target.totals.vNF)) {
    c.push(`vNF ${doc.vNF} ≠ ${target.totals.vNF}`);
  }
  // doc CANCELLED no ERP com XML "autorizado" no lote (evento não veio) NÃO é
  // conflito: o cancelamento nunca é revertido por importação.
  if (doc.items.length !== target.items.length) {
    c.push(`itens: ${doc.items.length} no ERP ≠ ${target.items.length} no XML`);
    return c;
  }
  const byN = new Map(doc.items.map((i) => [i.nItem, i]));
  for (const ti of target.items) {
    const ei = byN.get(ti.nItem);
    if (!ei) {
      c.push(`item ${ti.nItem} sem correspondente por nItem no ERP`);
      continue;
    }
    if ((ei.productCode ?? null) !== (ti.productCode ?? null)) c.push(`item ${ti.nItem} cProd ${ei.productCode} ≠ ${ti.productCode}`);
    if (!sameDecimal(ei.quantity, ti.quantity)) c.push(`item ${ti.nItem} quantity ${ei.quantity} ≠ ${ti.quantity}`);
    // unitPrice: Decimal(14,4) no ERP × até 10 casas no XML — compara na precisão da coluna
    if (!sameDecimal(ei.unitPrice, roundDecimalString(ti.unitPrice, 4))) c.push(`item ${ti.nItem} unitPrice ${ei.unitPrice} ≠ ${ti.unitPrice}`);
    if (!sameDecimal(ei.totalPrice, ti.totalPrice)) c.push(`item ${ti.nItem} totalPrice ${ei.totalPrice} ≠ ${ti.totalPrice}`);
  }
  return c;
}

// ─── Lote: dedupe + eventos órfãos ───────────────────────────────────────────

export interface ParsedFile {
  path: string;
  doc: ParsedNfeDocument | null;
  error: string | null; // XmlParseError / NfeXmlError
}

export interface BatchResult {
  plans: ImportPlan[];
  /** Eventos cuja nota não veio no lote nem existe no ERP — preservados, não representados. */
  orphanEvents: Array<{ chNFe: string; tpEvento: string; path: string }>;
  invalidFiles: Array<{ path: string; error: string }>;
  unknownFiles: Array<{ path: string; rootName: string }>;
  /** Mesma chave em >1 arquivo com conteúdo fiscal divergente ⇒ CONFLICT. */
  duplicateChaves: Array<{ chave: string; paths: string[]; divergent: boolean }>;
}

/**
 * Monta os eventos por chave e planeja cada NF-e uma única vez. Arquivos
 * duplicados da mesma chave (ex.: em Autorizadas E Canceladas) são aceitos se
 * idênticos em dhEmi/nProt/vNF; divergentes viram CONFLICT.
 */
export function planBatch(files: ParsedFile[], ctxWithoutEvents: Omit<ImportContext, 'eventsByChave'>): BatchResult {
  const eventsByChave = new Map<string, ParsedEvento[]>();
  const eventPaths = new Map<string, string[]>();
  const nfes = new Map<string, { nfe: ParsedNfe; paths: string[]; divergent: boolean }>();
  const invalidFiles: BatchResult['invalidFiles'] = [];
  const unknownFiles: BatchResult['unknownFiles'] = [];

  for (const f of files) {
    if (f.error !== null || f.doc === null) {
      invalidFiles.push({ path: f.path, error: f.error ?? 'sem conteúdo' });
      continue;
    }
    if (f.doc.kind === 'EVENTO') {
      eventsByChave.set(f.doc.chNFe, [...(eventsByChave.get(f.doc.chNFe) ?? []), f.doc]);
      eventPaths.set(f.doc.chNFe, [...(eventPaths.get(f.doc.chNFe) ?? []), f.path]);
      continue;
    }
    if (f.doc.kind === 'UNKNOWN') {
      unknownFiles.push({ path: f.path, rootName: f.doc.rootName });
      continue;
    }
    const prev = nfes.get(f.doc.chave);
    if (!prev) {
      nfes.set(f.doc.chave, { nfe: f.doc, paths: [f.path], divergent: false });
    } else {
      prev.paths.push(f.path);
      const a = prev.nfe;
      const b = f.doc;
      if (a.dhEmi !== b.dhEmi || a.prot?.nProt !== b.prot?.nProt || !sameDecimal(a.totals.vNF ?? null, b.totals.vNF ?? null)) {
        prev.divergent = true;
      }
    }
  }

  const ctx: ImportContext = { ...ctxWithoutEvents, eventsByChave };
  const plans: ImportPlan[] = [];
  const duplicateChaves: BatchResult['duplicateChaves'] = [];
  for (const [chave, entry] of nfes) {
    if (entry.paths.length > 1) duplicateChaves.push({ chave, paths: entry.paths, divergent: entry.divergent });
    if (entry.divergent) {
      plans.push({
        chave, state: 'CONFLICT', reasons: [`${entry.paths.length} arquivos com a mesma chave e conteúdo fiscal divergente`],
        pendencies: [], companyId: null, target: null, update: null, existingDocId: null,
      });
      continue;
    }
    plans.push(buildTargetFromNfe(entry.nfe, ctx));
  }

  const orphanEvents: BatchResult['orphanEvents'] = [];
  for (const [chNFe, evs] of eventsByChave) {
    // Evento sem a nota no lote: o plano nasce do XML da NF-e, então um
    // cancelamento só é aplicado quando a nota vem junto — aqui é só reportado
    // (arquivo preservado), mesmo que a nota já exista no ERP.
    if (nfes.has(chNFe)) continue;
    const paths = eventPaths.get(chNFe) ?? [];
    evs.forEach((ev, i) => orphanEvents.push({ chNFe, tpEvento: ev.tpEvento, path: paths[i] ?? '' }));
  }

  return { plans, orphanEvents, invalidFiles, unknownFiles, duplicateChaves };
}

// ─── Evidência nominal (gate dry-run ⇄ commit) ───────────────────────────────

export interface NominalEvidence {
  insert: string[]; // "companyId|chave"
  update: string[]; // "docId|campos"
}

export function nominalEvidence(plans: ImportPlan[]): NominalEvidence {
  const key = (p: ImportPlan) => `${p.companyId}|${p.chave}`;
  const upd = (p: ImportPlan) => {
    const u = p.update!;
    const parts = [u.supplierId !== undefined ? `supplier=${u.supplierId}` : null, u.xml ? 'xml' : null, u.cancel ? `cancel=${u.cancel.cancelledAt}` : null].filter(Boolean);
    return `${u.docId}|${parts.join(',')}`;
  };
  return {
    insert: plans.filter((p) => p.state === 'INSERT').map(key).sort(),
    update: plans.filter((p) => p.state === 'UPDATE').map(upd).sort(),
  };
}
