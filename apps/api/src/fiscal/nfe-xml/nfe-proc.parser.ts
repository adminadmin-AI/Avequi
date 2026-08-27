/**
 * Parser estruturado da NF-e 4.00 (nfeProc) e dos eventos (procEventoNFe).
 *
 * Fundação ÚNICA de leitura de XML de NF-e do ERP: o importador dos XMLs
 * locais (Qive) e, depois, o fluxo Focus (#608) passam por AQUI — nunca por um
 * segundo parser dentro do cliente Focus. A saída é um DTO canônico, sem
 * float (valores ficam como string decimal exatamente como no XML), sem
 * decisão de negócio (company/supplier/direção são resolvidos no núcleo do
 * importador, não aqui).
 *
 * O que este parser NÃO faz de propósito:
 *  - não valida assinatura digital (a autorização vem de <protNFe>);
 *  - não inventa campos: só expõe o que o XML tem, e o núcleo só grava o que
 *    o schema (FiscalDocument/Item/ItemTax) modela.
 */
import { XmlNode, XmlParseError, child, children, findFirst, parseXml, path, text } from './xml-tree';

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface NfeParty {
  cnpj: string | null; // só dígitos
  cpf: string | null; // só dígitos
  xNome: string | null;
  ie: string | null;
  uf: string | null;
}

/** Grupo ICMS do item — o nome do subgrupo (ICMS00, ICMSSN102…) é preservado. */
export interface NfeItemIcms {
  grupo: string | null; // ICMS00 | ICMS10 | … | ICMSSN102 | ICMSST | ICMSPart
  orig: string | null;
  /** CST (regime normal) OU CSOSN (Simples) — o schema guarda ambos em cstIcms. */
  cst: string | null;
  csosn: string | null;
  modBC: string | null;
  vBC: string | null;
  pICMS: string | null;
  vICMS: string | null;
}

export interface NfeItemSimpleTax {
  grupo: string | null; // IPITrib | IPINT | PISAliq | PISNT | PISOutr | COFINSAliq …
  cst: string | null;
  vBC: string | null;
  aliquota: string | null; // pIPI | pPIS | pCOFINS
  valor: string | null; // vIPI | vPIS | vCOFINS
}

export interface NfeItemDifal {
  vBCUFDest: string | null;
  pFCPUFDest: string | null;
  pICMSUFDest: string | null;
  pICMSInter: string | null;
  vFCPUFDest: string | null;
  vICMSUFDest: string | null;
}

/** Grupo IBS/CBS (NT 2025.002-RTC) — presente só em notas da Reforma. */
export interface NfeItemIbsCbs {
  cst: string | null;
  cClassTrib: string | null;
  vBC: string | null;
  pIBSUF: string | null;
  vIBSUF: string | null;
  pIBSMun: string | null;
  vIBSMun: string | null;
  pCBS: string | null;
  vCBS: string | null;
}

export interface NfeItem {
  nItem: number;
  cProd: string | null;
  cEAN: string | null;
  xProd: string;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  uCom: string | null;
  qCom: string;
  vUnCom: string;
  vProd: string;
  icms: NfeItemIcms | null;
  ipi: NfeItemSimpleTax | null;
  pis: NfeItemSimpleTax | null;
  cofins: NfeItemSimpleTax | null;
  difal: NfeItemDifal | null;
  ibsCbs: NfeItemIbsCbs | null;
}

export const NFE_TOTAL_FIELDS = [
  'vProd', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vIPI',
  'vICMS', 'vICMSUFDest', 'vFCPUFDest', 'vPIS', 'vCOFINS', 'vNF',
] as const;
export type NfeTotalField = (typeof NFE_TOTAL_FIELDS)[number];

/** Totais do grupo <total><IBSCBSTot> (NT 2025.002-RTC) — só existem em notas com o grupo IBS/CBS. */
export const NFE_IBSCBS_TOTAL_FIELDS = ['vIBS', 'vCBS'] as const;
export type NfeIbsCbsTotalField = (typeof NFE_IBSCBS_TOTAL_FIELDS)[number];
export type NfeAnyTotalField = NfeTotalField | NfeIbsCbsTotalField;

export interface NfeProt {
  chNFe: string | null;
  dhRecbto: string | null;
  nProt: string | null;
  cStat: string | null;
  xMotivo: string | null;
  tpAmb: string | null;
}

export interface ParsedNfe {
  kind: 'NFE';
  /** Chave de acesso (44 dígitos) do atributo Id de <infNFe>. */
  chave: string;
  versao: string | null;
  mod: string | null; // 55 NF-e | 65 NFC-e
  serie: number | null;
  nNF: number | null;
  dhEmi: string | null; // ISO com offset, como no XML
  tpNF: number | null;
  natOp: string | null;
  finNFe: string | null;
  tpAmb: string | null;
  emit: NfeParty;
  dest: NfeParty;
  items: NfeItem[];
  totals: Partial<Record<NfeAnyTotalField, string>>;
  infCpl: string | null;
  /** null quando o XML é uma <NFe> sem <protNFe> (não autorizada/sem processo). */
  prot: NfeProt | null;
  /** Chave interna (Id) confere com <protNFe>/chNFe quando ambos existem. */
  chaveConsistente: boolean;
}

export interface ParsedEvento {
  kind: 'EVENTO';
  chNFe: string;
  tpEvento: string; // 110110 CC-e | 110111 cancelamento | 210210 ciência | …
  nSeqEvento: number | null;
  dhEvento: string | null;
  descEvento: string | null;
  xJust: string | null;
  xCorrecao: string | null;
  cnpjAutor: string | null;
  ret: { cStat: string | null; nProt: string | null; dhRegEvento: string | null } | null;
}

/**
 * Inutilização de numeração (procInutNFe). Só CLASSIFICADA e reportada: o ERP
 * modela FiscalVoidRange pela emissão própria (Focus) e este importador não
 * cria nem altera faixas — a situação real de uma faixa é assunto da SEFAZ.
 */
export interface ParsedInut {
  kind: 'INUT';
  cnpj: string | null;
  ano: string | null;
  mod: string | null;
  serie: number | null;
  nNFIni: number | null;
  nNFFin: number | null;
  xJust: string | null;
  ret: { cStat: string | null; nProt: string | null; dhRecbto: string | null } | null;
}

export interface ParsedUnknown {
  kind: 'UNKNOWN';
  rootName: string;
}

export type ParsedNfeDocument = ParsedNfe | ParsedEvento | ParsedInut | ParsedUnknown;

export const TP_EVENTO = {
  CARTA_CORRECAO: '110110',
  CANCELAMENTO: '110111',
  CIENCIA: '210210',
  CONFIRMACAO: '210200',
  DESCONHECIMENTO: '210220',
  NAO_REALIZADA: '210240',
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const digits = (v: string | null): string | null => (v === null ? null : v.replace(/\D/g, '') || null);

function toInt(v: string | null): number | null {
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Aceita só decimal em texto (evita gravar lixo); devolve null caso contrário. */
function dec(v: string | null): string | null {
  if (v === null) return null;
  return /^-?\d+(\.\d+)?$/.test(v) ? v : null;
}

function party(node: XmlNode | undefined, enderName: string): NfeParty {
  return {
    cnpj: digits(text(node, 'CNPJ')),
    cpf: digits(text(node, 'CPF')),
    xNome: text(node, 'xNome'),
    ie: text(node, 'IE'),
    uf: text(node, enderName, 'UF'),
  };
}

function parseIcms(imposto: XmlNode | undefined): NfeItemIcms | null {
  const icms = child(imposto, 'ICMS');
  if (!icms) return null;
  const g = icms.children[0]; // exatamente um subgrupo (ICMS00, ICMSSN102, …)
  if (!g) return null;
  return {
    grupo: g.name,
    orig: text(g, 'orig'),
    cst: text(g, 'CST'),
    csosn: text(g, 'CSOSN'),
    modBC: text(g, 'modBC'),
    vBC: dec(text(g, 'vBC')),
    pICMS: dec(text(g, 'pICMS')),
    vICMS: dec(text(g, 'vICMS')),
  };
}

function parseSimple(imposto: XmlNode | undefined, tag: 'IPI' | 'PIS' | 'COFINS'): NfeItemSimpleTax | null {
  const outer = child(imposto, tag);
  if (!outer) return null;
  // IPI tem cEnq/CNPJProd fora do subgrupo; o subgrupo é o filho com CST.
  const g = outer.children.find((c) => child(c, 'CST') !== undefined) ?? outer.children[0];
  if (!g) return null;
  const p = { IPI: 'pIPI', PIS: 'pPIS', COFINS: 'pCOFINS' }[tag];
  const v = { IPI: 'vIPI', PIS: 'vPIS', COFINS: 'vCOFINS' }[tag];
  return {
    grupo: g.name,
    cst: text(g, 'CST'),
    vBC: dec(text(g, 'vBC')),
    aliquota: dec(text(g, p)),
    valor: dec(text(g, v)),
  };
}

function parseDifal(imposto: XmlNode | undefined): NfeItemDifal | null {
  const g = child(imposto, 'ICMSUFDest');
  if (!g) return null;
  return {
    vBCUFDest: dec(text(g, 'vBCUFDest')),
    pFCPUFDest: dec(text(g, 'pFCPUFDest')),
    pICMSUFDest: dec(text(g, 'pICMSUFDest')),
    pICMSInter: dec(text(g, 'pICMSInter')),
    vFCPUFDest: dec(text(g, 'vFCPUFDest')),
    vICMSUFDest: dec(text(g, 'vICMSUFDest')),
  };
}

function parseIbsCbs(imposto: XmlNode | undefined): NfeItemIbsCbs | null {
  const g = child(imposto, 'IBSCBS');
  if (!g) return null;
  const gi = child(g, 'gIBSCBS');
  return {
    cst: text(g, 'CST'),
    cClassTrib: text(g, 'cClassTrib'),
    vBC: dec(text(gi, 'vBC')),
    pIBSUF: dec(text(gi, 'gIBSUF', 'pIBSUF')),
    vIBSUF: dec(text(gi, 'gIBSUF', 'vIBSUF')),
    pIBSMun: dec(text(gi, 'gIBSMun', 'pIBSMun')),
    vIBSMun: dec(text(gi, 'gIBSMun', 'vIBSMun')),
    pCBS: dec(text(gi, 'gCBS', 'pCBS')),
    vCBS: dec(text(gi, 'gCBS', 'vCBS')),
  };
}

function parseItem(det: XmlNode): NfeItem {
  const prod = child(det, 'prod');
  const imposto = child(det, 'imposto');
  const nItem = toInt(det.attrs.nItem ?? null);
  if (nItem === null) throw new NfeXmlError(`<det> sem atributo nItem numérico`);
  const xProd = text(prod, 'xProd');
  const qCom = dec(text(prod, 'qCom'));
  const vUnCom = dec(text(prod, 'vUnCom'));
  const vProd = dec(text(prod, 'vProd'));
  if (xProd === null || qCom === null || vUnCom === null || vProd === null) {
    throw new NfeXmlError(`item ${nItem}: xProd/qCom/vUnCom/vProd obrigatórios ausentes ou inválidos`);
  }
  return {
    nItem,
    cProd: text(prod, 'cProd'),
    cEAN: text(prod, 'cEAN'),
    xProd,
    ncm: text(prod, 'NCM'),
    cest: text(prod, 'CEST'),
    cfop: text(prod, 'CFOP'),
    uCom: text(prod, 'uCom'),
    qCom,
    vUnCom,
    vProd,
    icms: parseIcms(imposto),
    ipi: parseSimple(imposto, 'IPI'),
    pis: parseSimple(imposto, 'PIS'),
    cofins: parseSimple(imposto, 'COFINS'),
    difal: parseDifal(imposto),
    ibsCbs: parseIbsCbs(imposto),
  };
}

export class NfeXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NfeXmlError';
  }
}

// ─── Entrada pública ─────────────────────────────────────────────────────────

/**
 * Classifica e faz o parse de um XML de NF-e (nfeProc/NFe), de evento
 * (procEventoNFe/evento) ou de inutilização (procInutNFe/inutNFe). Lança XmlParseError (XML malformado) ou
 * NfeXmlError (estrutura de NF-e inválida). Nunca devolve nota "parcial".
 */
export function parseNfeDocument(xml: string): ParsedNfeDocument {
  const root = parseXml(xml);

  if (root.name === 'nfeProc' || root.name === 'NFe') {
    const nfe = root.name === 'NFe' ? root : child(root, 'NFe');
    const inf = child(nfe, 'infNFe');
    if (!nfe || !inf) throw new NfeXmlError('<NFe>/<infNFe> ausente');
    const id = inf.attrs.Id ?? '';
    const m = id.match(/^NFe(\d{44})$/);
    if (!m) throw new NfeXmlError(`infNFe/@Id inválido: "${id}"`);
    const chave = m[1];
    const ide = child(inf, 'ide');
    const prot = root.name === 'nfeProc' ? path(root, 'protNFe', 'infProt') : undefined;
    const protDto: NfeProt | null = prot
      ? {
          chNFe: digits(text(prot, 'chNFe')),
          dhRecbto: text(prot, 'dhRecbto'),
          nProt: text(prot, 'nProt'),
          cStat: text(prot, 'cStat'),
          xMotivo: text(prot, 'xMotivo'),
          tpAmb: text(prot, 'tpAmb'),
        }
      : null;
    const totNode = path(inf, 'total', 'ICMSTot');
    const totals: Partial<Record<NfeAnyTotalField, string>> = {};
    for (const f of NFE_TOTAL_FIELDS) {
      const v = dec(text(totNode, f));
      if (v !== null) totals[f] = v;
    }
    // W03: IBSCBSTot > gIBS > vIBS ; IBSCBSTot > gCBS > vCBS (sem inventar quando ausente)
    const ibsCbsTot = path(inf, 'total', 'IBSCBSTot');
    const vIBS = dec(text(ibsCbsTot, 'gIBS', 'vIBS'));
    const vCBS = dec(text(ibsCbsTot, 'gCBS', 'vCBS'));
    if (vIBS !== null) totals.vIBS = vIBS;
    if (vCBS !== null) totals.vCBS = vCBS;
    const items = children(inf, 'det').map(parseItem);
    if (items.length === 0) throw new NfeXmlError('NF-e sem <det> (itens)');
    return {
      kind: 'NFE',
      chave,
      versao: inf.attrs.versao ?? null,
      mod: text(ide, 'mod'),
      serie: toInt(text(ide, 'serie')),
      nNF: toInt(text(ide, 'nNF')),
      dhEmi: text(ide, 'dhEmi') ?? text(ide, 'dEmi'),
      tpNF: toInt(text(ide, 'tpNF')),
      natOp: text(ide, 'natOp'),
      finNFe: text(ide, 'finNFe'),
      tpAmb: text(ide, 'tpAmb'),
      emit: party(child(inf, 'emit'), 'enderEmit'),
      dest: party(child(inf, 'dest'), 'enderDest'),
      items,
      totals,
      infCpl: text(inf, 'infAdic', 'infCpl'),
      prot: protDto,
      chaveConsistente: protDto === null || protDto.chNFe === null ? true : protDto.chNFe === chave,
    };
  }

  if (root.name === 'procEventoNFe' || root.name === 'evento') {
    const evento = root.name === 'evento' ? root : child(root, 'evento');
    const inf = child(evento, 'infEvento');
    if (!inf) throw new NfeXmlError('<evento>/<infEvento> ausente');
    const chNFe = digits(text(inf, 'chNFe'));
    const tpEvento = text(inf, 'tpEvento');
    if (!chNFe || chNFe.length !== 44 || !tpEvento) throw new NfeXmlError('evento sem chNFe/tpEvento válidos');
    const det = child(inf, 'detEvento');
    const ret = root.name === 'procEventoNFe' ? findFirst(child(root, 'retEvento'), 'infEvento') : undefined;
    return {
      kind: 'EVENTO',
      chNFe,
      tpEvento,
      nSeqEvento: toInt(text(inf, 'nSeqEvento')),
      dhEvento: text(inf, 'dhEvento'),
      descEvento: text(det, 'descEvento'),
      xJust: text(det, 'xJust'),
      xCorrecao: text(det, 'xCorrecao'),
      cnpjAutor: digits(text(inf, 'CNPJ')),
      ret: ret
        ? { cStat: text(ret, 'cStat'), nProt: text(ret, 'nProt'), dhRegEvento: text(ret, 'dhRegEvento') }
        : null,
    };
  }

  if (root.name === 'procInutNFe' || root.name === 'inutNFe') {
    const inut = root.name === 'inutNFe' ? root : child(root, 'inutNFe');
    const inf = child(inut, 'infInut');
    if (!inf) throw new NfeXmlError('<inutNFe>/<infInut> ausente');
    const ret = root.name === 'procInutNFe' ? findFirst(child(root, 'retInutNFe'), 'infInut') : undefined;
    return {
      kind: 'INUT',
      cnpj: digits(text(inf, 'CNPJ')),
      ano: text(inf, 'ano'),
      mod: text(inf, 'mod'),
      serie: toInt(text(inf, 'serie')),
      nNFIni: toInt(text(inf, 'nNFIni')),
      nNFFin: toInt(text(inf, 'nNFFin')),
      xJust: text(inf, 'xJust'),
      ret: ret ? { cStat: text(ret, 'cStat'), nProt: text(ret, 'nProt'), dhRecbto: text(ret, 'dhRecbto') } : null,
    };
  }

  return { kind: 'UNKNOWN', rootName: root.name };
}

export { XmlParseError };
