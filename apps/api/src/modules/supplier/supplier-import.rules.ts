/**
 * Regras PURAS do importador de Suppliers a partir das NF-e RECEBIDAS (#611).
 *
 * A AUTORIDADE da existência do fornecedor é o próprio ERP pós-reidratação:
 * FiscalDocument com direction=RECEBIDA, supplierId=NULL e issuerCnpj
 * preenchido. stg/Omie NÃO descobrem fornecedor — só enriquecem campos.
 *
 * Precedência POR CAMPO (não por fonte genérica):
 *
 * | Campo                | 1ª escolha            | 2ª            | 3ª        |
 * |----------------------|-----------------------|---------------|-----------|
 * | cnpj (identidade)    | ERP issuerCnpj        | —             | —         |
 * | razaoSocial          | XML emit/xNome        | ERP issuerName| GDR homôn.|
 * | name (exibição)      | Omie fantasia         | XML xFant     | razão soc.|
 * | ie                   | XML emit/IE           | GDR homôn.    | —         |
 * | taxRegime            | XML emit/CRT (1/2→SN) | —             | —         |
 * | address…ibgeCode     | XML enderEmit         | GDR homôn.    | —         |
 * | phone                | XML emit/enderEmit/fone | —           | —         |
 * | email/contatos/banco/condições/leadTime/isActive | NUNCA herdados de outro
 * |                      | tenant (classe B) — nascem vazios/default          |
 *
 * "GDR homôn." = Supplier de MESMO CNPJ em outro tenant, usado campo a campo e
 * SOMENTE para os campos classe A abaixo — nunca clonagem do registro.
 */

import { decodeEntities } from '../../fiscal/nfe-xml/xml-tree';

// ── Classificação dos campos do model Supplier ────────────────────────────────
/** Classe A — identidade/fiscal/neutros: podem ser reaproveitados de um
 *  Supplier homônimo de outro tenant PARA PREENCHER LACUNA (campo a campo). */
export const CROSS_TENANT_REUSABLE_FIELDS = [
  'name',
  'razaoSocial',
  'ie',
  'taxRegime',
  'address',
  'number',
  'complement',
  'neighborhood',
  'city',
  'state',
  'zipCode',
  'ibgeCode',
] as const;

/** Classe B — relação fornecedor×empresa: NUNCA clonados entre tenants.
 *  (condições comerciais, contatos, dados bancários, flags operacionais) */
export const TENANT_SPECIFIC_FIELDS = [
  'email',
  'fiscalEmail',
  'phone',
  'phone2',
  'contactName',
  'defaultPaymentTerms',
  'bankName',
  'bankAgency',
  'bankAccount',
  'pixKey',
  'leadTimeDays',
  'isActive',
] as const;

export function normalizeCnpj(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

// ── Extração do bloco <emit> do XML da própria NF-e (guardado no ERP) ─────────
export interface EmitData {
  cnpj: string;
  xNome: string | null;
  xFant: string | null;
  ie: string | null;
  crt: string | null;
  address: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  ibgeCode: string | null;
  phone: string | null;
}

/**
 * Texto de uma tag do bloco, já com as entidades XML decodificadas
 * (`&amp;` → `&`, `&#39;` → `'` …) pela MESMA função do parser canônico de
 * NF-e (`nfe-xml/xml-tree.ts`). Sem isso, "B &amp; M" virava razão social
 * literal no cadastro (defeito visto nos 6 Suppliers com `&amp;` no nome).
 * A decodificação acontece uma única vez, aqui — nunca de novo a jusante.
 */
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([^<]+)</${name}>`));
  return m ? decodeEntities(m[1]).trim() : null;
}

/** Parse tolerante do emitente. Retorna null se não houver bloco <emit>. */
export function parseEmit(xml: string | null): EmitData | null {
  if (!xml) return null;
  const emitMatch = xml.match(/<emit>[\s\S]*?<\/emit>/);
  if (!emitMatch) return null;
  const emit = emitMatch[0];
  const ender = emit.match(/<enderEmit>[\s\S]*?<\/enderEmit>/)?.[0] ?? '';
  const cnpj = normalizeCnpj(tag(emit, 'CNPJ'));
  if (!cnpj) return null;
  return {
    cnpj,
    xNome: tag(emit, 'xNome'),
    xFant: tag(emit, 'xFant'),
    ie: tag(emit, 'IE'),
    crt: tag(emit, 'CRT'),
    address: tag(ender, 'xLgr'),
    number: tag(ender, 'nro'),
    complement: tag(ender, 'xCpl'),
    neighborhood: tag(ender, 'xBairro'),
    city: tag(ender, 'xMun'),
    state: tag(ender, 'UF'),
    zipCode: normalizeCnpj(tag(ender, 'CEP')) || null,
    ibgeCode: tag(ender, 'cMun'),
    phone: tag(ender, 'fone') ?? tag(emit, 'fone'),
  };
}

/** CRT da NF-e → TaxRegime do ERP. 1/2 = Simples; 3 = presumido OU real —
 *  indistinguível pela NF-e, então NÃO inferimos (fica vazio). */
export function taxRegimeFromCrt(crt: string | null): 'SIMPLES_NACIONAL' | null {
  return crt === '1' || crt === '2' ? 'SIMPLES_NACIONAL' : null;
}

// ── Ordenação temporal determinística das evidências ──────────────────────────
export interface DatedEmit {
  emit: EmitData;
  /** issueDate fiscal do documento (dhEmi reidratado); null = sem data */
  issueDate: string | null;
  /** desempate ESTÁVEL para issueDate igual/ausente */
  docId: string;
}

/**
 * Ordena evidências fiscais do MAIS RECENTE para o mais antigo, de forma
 * determinística e independente da ordem de leitura: issueDate desc; empate
 * (ou data ausente, que vai para o fim) desempata por docId asc. O resultado
 * cadastral NUNCA depende da ordem em que os XMLs foram fornecidos.
 */
export function orderEvidenceNewestFirst(evidence: DatedEmit[]): EmitData[] {
  return [...evidence]
    .sort((a, b) => {
      const ta = a.issueDate ? Date.parse(a.issueDate) : Number.NEGATIVE_INFINITY;
      const tb = b.issueDate ? Date.parse(b.issueDate) : Number.NEGATIVE_INFINITY;
      if (tb !== ta) return tb - ta;
      return a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0;
    })
    .map((e) => e.emit);
}

/**
 * Consolida as evidências (já ordenadas newest-first) num único cadastro:
 * cada campo usa o valor da evidência MAIS RECENTE que o possui — dado antigo
 * nunca sobrescreve dado recente; campo ausente no XML mais novo cai para o
 * próximo mais novo que o tenha. Identidade (cnpj) vem sempre da mais recente.
 */
export function mergeEmitsNewestFirst(emitsNewestFirst: EmitData[]): EmitData | null {
  if (emitsNewestFirst.length === 0) return null;
  const pick = <K extends keyof EmitData>(k: K): EmitData[K] | null =>
    (emitsNewestFirst.find((e) => e[k] !== null)?.[k] as EmitData[K] | undefined) ?? null;
  return {
    cnpj: emitsNewestFirst[0].cnpj,
    xNome: pick('xNome'),
    xFant: pick('xFant'),
    ie: pick('ie'),
    crt: pick('crt'),
    address: pick('address'),
    number: pick('number'),
    complement: pick('complement'),
    neighborhood: pick('neighborhood'),
    city: pick('city'),
    state: pick('state'),
    zipCode: pick('zipCode'),
    ibgeCode: pick('ibgeCode'),
    phone: pick('phone'),
  };
}

/** Identidade nominal do candidato (gate dry-run ⇄ commit). */
export function pairKey(companyId: string, cnpj: string): string {
  return `${companyId}|${normalizeCnpj(cnpj)}`;
}

// ── Montagem do cadastro (precedência por campo) ──────────────────────────────
export interface CandidateSources {
  companyId: string;
  issuerCnpj: string;
  /** issuerName mais recente vindo do FiscalDocument */
  issuerName: string | null;
  /** emit do XML confiável MAIS RECENTE (evidência fiscal atual) */
  latestEmit: EmitData | null;
  /** Supplier de mesmo CNPJ em OUTRO tenant (campos classe A apenas) */
  crossTenant: Partial<Record<(typeof CROSS_TENANT_REUSABLE_FIELDS)[number], string | null>> | null;
  /** fantasia do Omie, quando disponível (enriquecimento secundário) */
  omieFantasia: string | null;
}

export interface SupplierDraft {
  companyId: string;
  cnpj: string;
  name: string;
  razaoSocial: string | null;
  ie: string | null;
  taxRegime: 'SIMPLES_NACIONAL' | null;
  address: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  ibgeCode: string | null;
  phone: string | null;
}

export function buildSupplierDraft(src: CandidateSources): SupplierDraft {
  const e = src.latestEmit;
  const ct = src.crossTenant;
  const razaoSocial = e?.xNome ?? src.issuerName ?? ct?.razaoSocial ?? null;
  const name = src.omieFantasia ?? e?.xFant ?? razaoSocial ?? src.issuerCnpj;
  return {
    companyId: src.companyId,
    cnpj: src.issuerCnpj,
    name,
    razaoSocial,
    ie: e?.ie ?? ct?.ie ?? null,
    taxRegime: taxRegimeFromCrt(e?.crt ?? null),
    address: e?.address ?? ct?.address ?? null,
    number: e?.number ?? ct?.number ?? null,
    complement: e?.complement ?? ct?.complement ?? null,
    neighborhood: e?.neighborhood ?? ct?.neighborhood ?? null,
    city: e?.city ?? ct?.city ?? null,
    state: e?.state ?? ct?.state ?? null,
    zipCode: e?.zipCode ?? ct?.zipCode ?? null,
    ibgeCode: e?.ibgeCode ?? ct?.ibgeCode ?? null,
    phone: e?.phone ?? null, // fone da NF-e é dado fiscal; NUNCA herdado de outro tenant
  };
}

// ── Conflitos ─────────────────────────────────────────────────────────────────
export interface EvidenceTimeline {
  /** emits dos XMLs confiáveis do par, do MAIS RECENTE para o mais antigo */
  emitsNewestFirst: EmitData[];
  distinctIssuerNames: string[];
}

export interface ConflictAssessment {
  review: boolean;
  reasons: string[];
  /** informativo: mudanças históricas legítimas (não bloqueiam) */
  notes: string[];
}

/**
 * Política conservadora: a evidência fiscal confiável MAIS RECENTE define o
 * cadastro atual. Mudança de razão social/endereço/município ao longo do tempo
 * é história legítima (vira nota). AMBIGUIDADE MATERIAL → review (não cria):
 *  - CNPJ interno do XML divergente do issuerCnpj (identidade quebrada);
 *  - mais de uma IE distinta entre os DOIS XMLs mais recentes (não explicado
 *    por evolução temporal simples).
 * CNPJ divergente nunca é reconciliado por nome; nomes parecidos nunca
 * deduplicam fornecedores diferentes.
 */
export function assessConflicts(issuerCnpj: string, ev: EvidenceTimeline): ConflictAssessment {
  const reasons: string[] = [];
  const notes: string[] = [];
  for (const e of ev.emitsNewestFirst) {
    if (e.cnpj !== issuerCnpj) {
      reasons.push(`XML com CNPJ interno ${e.cnpj} ≠ issuerCnpj ${issuerCnpj}`);
    }
  }
  const [newest, second] = ev.emitsNewestFirst;
  if (newest && second && newest.ie && second.ie && newest.ie !== second.ie) {
    reasons.push(`IE divergente entre os dois XMLs mais recentes (${second.ie} → ${newest.ie})`);
  }
  const allIes = new Set(ev.emitsNewestFirst.map((e) => e.ie).filter(Boolean));
  if (allIes.size > 1 && reasons.length === 0) {
    notes.push(`IE mudou ao longo do histórico (${[...allIes].join(', ')}) — usando a mais recente`);
  }
  const allNames = new Set(ev.emitsNewestFirst.map((e) => e.xNome).filter(Boolean));
  if (allNames.size > 1) {
    notes.push(`razão social mudou ao longo do histórico — usando a mais recente`);
  }
  if (ev.distinctIssuerNames.length > 1) {
    notes.push(`issuerName tem ${ev.distinctIssuerNames.length} variantes no histórico`);
  }
  return { review: reasons.length > 0, reasons, notes };
}

// ── Decisão de criação (idempotência) ─────────────────────────────────────────
export type CreateDecision = 'CREATE' | 'ALREADY_EXISTS' | 'REVIEW';

/**
 * Match local é SÓ no mesmo tenant: Supplier de outro tenant nunca conta como
 * existente (o mesmo CNPJ em GDR e CRD é legítimo e esperado).
 */
export function decideCreation(
  existsInSameTenant: boolean,
  conflict: ConflictAssessment,
): CreateDecision {
  if (existsInSameTenant) return 'ALREADY_EXISTS';
  if (conflict.review) return 'REVIEW';
  return 'CREATE';
}
