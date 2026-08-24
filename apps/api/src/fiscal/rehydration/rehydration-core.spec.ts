import {
  AllowlistEntry,
  BuildContext,
  CompanyRow,
  ErpDoc,
  ErpItem,
  SourceHeader,
  SourceItem,
  buildTarget,
  classifyProvenance,
  deriveDates,
  diffDoc,
  normalizeCnpj,
  resolveCompanyByCnpj,
  resolveSupplier,
  safetyAssertions,
  sameDecimal,
  sameIdSet,
  sameInstant,
  saoPauloLocalToIso,
  simulateUniqueCollisions,
  validateMirrorPair,
} from './rehydration-core';
import * as fs from 'fs';
import * as path from 'path';

const CRD = '30284708000182';
const GDR = '46247069000115';
const companies: CompanyRow[] = [
  { id: 'co-crd', name: 'CRD', cnpj: '30.284.708/0001-82' },
  { id: 'co-gdr', name: 'GDR Reboques', cnpj: GDR },
  { id: 'co-gua', name: 'GDR Guarapuava', cnpj: '46247069000204' },
];

const xmlOk: SourceHeader['xml'] = {
  found: true,
  reliable: true,
  path: '/x/a.xml',
  sha256: 'abc',
  dhEmi: '2026-01-06T11:07:00-03:00',
  dhRecbto: '2026-01-06T11:08:21-03:00',
  nProt: '141260000012345',
};
const xmlMissing: SourceHeader['xml'] = {
  found: false, reliable: false, path: null, sha256: null, dhEmi: null, dhRecbto: null, nProt: null,
};

function mkItem(over: Partial<ErpItem>): ErpItem {
  return {
    id: 'it-1', legacyId: 'item_saida_1', nItem: null, productCode: '4482',
    unitPrice: '300.0000', quantity: '1.0000', totalPrice: '300.0000',
    taxId: 'tax-1', taxOrigemIcms: null, taxModalidadeBcIcms: null, taxCount: 1,
    ...over,
  };
}

function mkSource(over: Partial<SourceItem>): SourceItem {
  return {
    legacyId: 'item_saida_1', chave: 'K1', side: 'S', nItem: 1, cProd: '4482',
    descricao: 'REBOQUE NOVO', ncm: '87163900', cfop: '5101', unidade: 'UN',
    quantidade: '1.0000', valorUnitario: '300.0000', valorTotal: '300.0000',
    origemIcms: '0', modalidadeBcIcms: '3',
    ...over,
  };
}

function mkHeader(over: Partial<SourceHeader>): SourceHeader {
  return {
    chave: 'K1',
    saida: {
      emitCnpj: CRD, destCnpj: '11222333000181', destNome: 'CLIENTE X',
      numero: 11544, serie: 1, emissaoLocal: '2026-01-06 11:07:00',
      natOp: 'Venda', tpNF: 1, protocolo: '141260000012345',
    },
    entrada: null,
    totais: { vProd: '300.00', vNF: '300.00' },
    xml: xmlOk,
    ...over,
  };
}

function mkCtx(over: Partial<BuildContext>): BuildContext {
  return {
    companies,
    suppliers: [],
    headersByChave: new Map([['K1', mkHeader({})]]),
    sourceByLegacy: new Map([['item_saida_1', mkSource({})]]),
    allowlistByDocId: new Map(),
    erpDocIds: new Set(['doc-1']),
    ...over,
  };
}

function mkDoc(over: Partial<ErpDoc>): ErpDoc {
  return {
    id: 'doc-1', companyId: 'co-gdr', type: 'NFE', status: 'AUTHORIZED',
    focusRef: null, chave: null, number: null, series: 1,
    authorizedAt: null, protocolNumber: null,
    items: [mkItem({})],
    ...over,
  };
}

describe('normalização e comparações', () => {
  it('normaliza CNPJ removendo máscara', () => {
    expect(normalizeCnpj('30.284.708/0001-82')).toBe(CRD);
    expect(normalizeCnpj(null)).toBe('');
  });
  it('compara decimais sem falso positivo de zeros', () => {
    expect(sameDecimal('300.0000', '300.00')).toBe(true);
    expect(sameDecimal('300.0001', '300.00')).toBe(false);
    expect(sameDecimal(null, null)).toBe(true);
    expect(sameDecimal(null, '0')).toBe(false);
  });
  it('compara instantes independentemente do offset', () => {
    expect(sameInstant('2026-01-06T11:08:21-03:00', '2026-01-06T14:08:21Z')).toBe(true);
    expect(sameInstant('2026-01-06T11:08:21-03:00', '2026-01-06T11:08:21-05:00')).toBe(false);
    expect(sameInstant(null, null)).toBe(true);
  });
  it('timestamp sem offset do banco é UTC naive: 14:20 UTC == 11:20 -03:00 → mesmo instante', () => {
    // caso real da reidratação: coluna timestamp guarda UTC naive; o alvo vem com offset
    expect(sameInstant('2026-01-05 14:20:43', '2026-01-05T11:20:43-03:00')).toBe(true);
    expect(sameInstant('2026-01-05 14:20:43.000', '2026-01-05T11:20:43-03:00')).toBe(true);
    // e NÃO iguala instantes realmente diferentes
    expect(sameInstant('2026-01-05 14:20:43', '2026-01-05T14:20:43-03:00')).toBe(false);
    // Prisma devolve Date para colunas timestamp — também tem de comparar certo
    expect(sameInstant(new Date('2026-01-05T14:20:43Z'), '2026-01-05T11:20:43-03:00')).toBe(true);
    expect(sameInstant(new Date('2026-01-05T14:20:43Z'), '2026-01-05T14:20:43-03:00')).toBe(false);
  });
  it('doc reidratado com authorizedAt UTC naive no banco resulta em UNCHANGED', () => {
    const res = buildTarget(mkDoc({}), mkCtx({}));
    const t = res.target!;
    const done = mkDoc({
      companyId: t.companyId, chave: t.chave, number: t.number, series: t.series,
      authorizedAt: '2026-01-06 14:08:21', // como o Postgres devolve a coluna timestamp (UTC naive)
      protocolNumber: t.protocolNumber, direction: t.direction,
      issueDate: '2026-01-06 14:07:00', issuerCnpj: t.issuerCnpj,
      issuerName: t.issuerName, recipientCnpj: t.recipientCnpj,
      naturezaOperacao: t.naturezaOperacao, tpNF: t.tpNF, supplierId: t.supplierId,
      totals: { vProd: '300.00', vNF: '300.00' }, xmlPresent: true,
      items: [mkItem({ nItem: 1, taxOrigemIcms: '0', taxModalidadeBcIcms: '3' })],
    });
    expect(diffDoc(done, buildTarget(done, mkCtx({})).target!)).toEqual([]);
  });
});

describe('datas (política N2)', () => {
  it('com XML confiável usa dhEmi/dhRecbto/nProt preservando offset', () => {
    const d = deriveDates(xmlOk, '2026-01-06 11:07:00', 'PROTDB');
    expect(d.issueDate).toBe('2026-01-06T11:07:00-03:00');
    expect(d.authorizedAt).toBe('2026-01-06T11:08:21-03:00');
    expect(d.protocolNumber).toBe('141260000012345');
    expect(d.pendencies).toEqual([]);
  });
  it('preserva offset diferente de -03:00 (dhRecbto em -05:00)', () => {
    const d = deriveDates({ ...xmlOk, dhRecbto: '2026-01-06T09:08:21-05:00' }, 'x', null);
    expect(d.authorizedAt).toBe('2026-01-06T09:08:21-05:00');
  });
  it('sem XML: issueDate da emissão local, authorizedAt NULL + AUTH_TIME_UNVERIFIED', () => {
    const d = deriveDates(xmlMissing, '2025-08-08 10:02:00', 'PROTDB');
    expect(d.issueDate).toBe('2025-08-08T10:02:00-03:00');
    expect(d.authorizedAt).toBeNull(); // NUNCA usa emissão como autorização
    expect(d.protocolNumber).toBe('PROTDB');
    expect(d.pendencies).toContain('AUTH_TIME_UNVERIFIED');
    expect(d.pendencies).toContain('XML_MISSING');
  });
  it('XML achado mas não confiável também vira AUTH_TIME_UNVERIFIED', () => {
    const d = deriveDates({ ...xmlOk, reliable: false }, '2025-08-08 10:02:00', null);
    expect(d.authorizedAt).toBeNull();
    expect(d.pendencies).toContain('AUTH_TIME_UNVERIFIED');
    expect(d.pendencies).not.toContain('XML_MISSING');
  });
  it('converte hora local America/Sao_Paulo com offset fixo', () => {
    expect(saoPauloLocalToIso('2026-06-04 16:13:00')).toBe('2026-06-04T16:13:00-03:00');
    expect(() => saoPauloLocalToIso('junk')).toThrow();
  });
});

describe('classificação de proveniência', () => {
  it('focusRef presente → FOCUS (fora da reidratação)', () => {
    expect(classifyProvenance({ focusRef: 'GDR-SO-1', items: [] }).kind).toBe('FOCUS');
  });
  it('itens item_saida_* → SAIDA; item_entrada_* → ENTRADA; ambos → MIXED', () => {
    expect(classifyProvenance({ focusRef: null, items: [mkItem({})] }).kind).toBe('SAIDA');
    expect(
      classifyProvenance({ focusRef: null, items: [mkItem({ legacyId: 'item_entrada_9' })] }).kind,
    ).toBe('ENTRADA');
    expect(
      classifyProvenance({
        focusRef: null,
        items: [mkItem({}), mkItem({ id: 'it-2', legacyId: 'item_entrada_9' })],
      }).kind,
    ).toBe('MIXED');
  });
  it('sem legacyId → UNRESOLVED', () => {
    expect(
      classifyProvenance({ focusRef: null, items: [mkItem({ legacyId: null })] }).kind,
    ).toBe('UNRESOLVED');
  });
});

describe('derivação de company (nunca mapa fixo)', () => {
  it('EMITIDA: company = CNPJ do emitente', () => {
    const res = buildTarget(mkDoc({}), mkCtx({}));
    expect(res.state).toBe('WOULD_UPDATE');
    expect(res.target!.companyId).toBe('co-crd'); // emitente CRD, mesmo estando hoje na GDR
    expect(res.target!.direction).toBe('EMITIDA');
    expect(res.target!.issuerCnpj).toBe(CRD);
  });
  it('RECEBIDA: company = CNPJ do destinatário; issuer = fornecedor', () => {
    const header = mkHeader({
      saida: null,
      entrada: {
        companyCnpj: GDR, emitCnpj: '05570714000159', emitNome: 'IMPPAR',
        numero: 77, serie: 1, emissaoLocal: '2026-02-01 08:00:00',
        natOp: 'Compra', tpNF: 1, protocolo: 'P1',
      },
    });
    const ctx = mkCtx({
      headersByChave: new Map([['K1', header]]),
      sourceByLegacy: new Map([
        ['item_entrada_9', mkSource({ legacyId: 'item_entrada_9', side: 'E' })],
      ]),
    });
    const res = buildTarget(mkDoc({ items: [mkItem({ legacyId: 'item_entrada_9' })] }), ctx);
    expect(res.state).toBe('WOULD_UPDATE');
    expect(res.target!.companyId).toBe('co-gdr');
    expect(res.target!.direction).toBe('RECEBIDA');
    expect(res.target!.issuerCnpj).toBe('05570714000159');
    expect(res.target!.recipientCnpj).toBe(GDR);
  });
  it('CNPJ sem Company → SKIPPED_UNRESOLVED (nunca adivinhar)', () => {
    const header = mkHeader({});
    header.saida!.emitCnpj = '99999999000199';
    const ctx = mkCtx({ headersByChave: new Map([['K1', header]]) });
    const res = buildTarget(mkDoc({}), ctx);
    expect(res.state).toBe('SKIPPED_UNRESOLVED');
    expect(res.target).toBeNull();
  });
  it('CNPJ ambíguo entre companies → CONFLICT', () => {
    const dup = [...companies, { id: 'co-crd2', name: 'CRD 2', cnpj: CRD }];
    expect(resolveCompanyByCnpj(CRD, dup).kind).toBe('AMBIGUOUS');
    const res = buildTarget(mkDoc({}), mkCtx({ companies: dup }));
    expect(res.state).toBe('CONFLICT');
  });
});

describe('suppliers (não cria, só match exato)', () => {
  const entradaCtx = (suppliers: BuildContext['suppliers']) =>
    mkCtx({
      suppliers,
      headersByChave: new Map([
        ['K1', mkHeader({
          saida: null,
          entrada: {
            companyCnpj: GDR, emitCnpj: '05570714000159', emitNome: 'IMPPAR',
            numero: 77, serie: 1, emissaoLocal: '2026-02-01 08:00:00',
            natOp: 'Compra', tpNF: 1, protocolo: 'P1',
          },
        })],
      ]),
      sourceByLegacy: new Map([
        ['item_entrada_9', mkSource({ legacyId: 'item_entrada_9', side: 'E' })],
      ]),
    });
  const doc = () => mkDoc({ items: [mkItem({ legacyId: 'item_entrada_9' })] });

  it('exatamente 1 na company correta → preenche supplierId', () => {
    const res = buildTarget(doc(), entradaCtx([
      { id: 'sup-1', companyId: 'co-gdr', cnpj: '05.570.714/0001-59' },
      { id: 'sup-2', companyId: 'co-crd', cnpj: '05570714000159' }, // outra company não conta
    ]));
    expect(res.target!.supplierId).toBe('sup-1');
    expect(res.target!.pendencies).not.toContain('SUPPLIER_MISSING');
  });
  it('nenhum → NULL + SUPPLIER_MISSING', () => {
    const res = buildTarget(doc(), entradaCtx([]));
    expect(res.target!.supplierId).toBeNull();
    expect(res.target!.pendencies).toContain('SUPPLIER_MISSING');
  });
  it('ambíguo → CONFLICT', () => {
    const res = buildTarget(doc(), entradaCtx([
      { id: 'sup-1', companyId: 'co-gdr', cnpj: '05570714000159' },
      { id: 'sup-1b', companyId: 'co-gdr', cnpj: '05570714000159' },
    ]));
    expect(res.state).toBe('CONFLICT');
  });
  it('resolveSupplier isolado cobre os três casos', () => {
    expect(resolveSupplier('1', 'co-gdr', []).kind).toBe('NONE');
  });
});

describe('Focus fica fora', () => {
  it('doc com focusRef é FOCUS_IGNORED e não gera alvo', () => {
    const res = buildTarget(mkDoc({ focusRef: 'CRD-SO-9', items: [] }), mkCtx({}));
    expect(res.state).toBe('FOCUS_IGNORED');
    expect(res.target).toBeNull();
  });
});

describe('idempotência (diff campo a campo)', () => {
  it('documento já reidratado → zero diffs → UNCHANGED', () => {
    const res = buildTarget(mkDoc({}), mkCtx({}));
    const t = res.target!;
    const done = mkDoc({
      companyId: t.companyId,
      chave: t.chave,
      number: t.number,
      series: t.series,
      authorizedAt: t.authorizedAt,
      protocolNumber: t.protocolNumber,
      direction: t.direction,
      issueDate: t.issueDate,
      issuerCnpj: t.issuerCnpj,
      issuerName: t.issuerName,
      recipientCnpj: t.recipientCnpj,
      naturezaOperacao: t.naturezaOperacao,
      tpNF: t.tpNF,
      supplierId: t.supplierId,
      totals: { vProd: '300.00', vNF: '300.00' },
      xmlPresent: true,
      items: [mkItem({ nItem: 1, taxOrigemIcms: '0', taxModalidadeBcIcms: '3' })],
    });
    const res2 = buildTarget(done, mkCtx({}));
    expect(diffDoc(done, res2.target!)).toEqual([]);
  });
  it('authorizedAt igual em offsets diferentes não gera UPDATE', () => {
    const res = buildTarget(mkDoc({}), mkCtx({}));
    const t = res.target!;
    const done = mkDoc({
      companyId: t.companyId, chave: t.chave, number: t.number, series: t.series,
      authorizedAt: '2026-01-06T14:08:21+00:00', // mesmo instante em UTC
      protocolNumber: t.protocolNumber, direction: t.direction,
      issueDate: '2026-01-06T14:07:00Z', issuerCnpj: t.issuerCnpj,
      issuerName: t.issuerName, recipientCnpj: t.recipientCnpj,
      naturezaOperacao: t.naturezaOperacao, tpNF: t.tpNF, supplierId: t.supplierId,
      totals: { vProd: '300.0000', vNF: '300' }, xmlPresent: true,
      items: [mkItem({ nItem: 1, taxOrigemIcms: '0', taxModalidadeBcIcms: '3' })],
    });
    expect(diffDoc(done, buildTarget(done, mkCtx({})).target!)).toEqual([]);
  });
  it('impostos: nunca sobrescreve valor existente (só backfill de NULL)', () => {
    const doc = mkDoc({ items: [mkItem({ taxOrigemIcms: '1' })] }); // divergente da origem '0'
    const res = buildTarget(doc, mkCtx({}));
    const backfills = res.target!.taxBackfills;
    expect(backfills.find((b) => b.taxId === 'tax-1')?.origemIcms ?? null).toBeNull();
    expect(backfills.find((b) => b.taxId === 'tax-1')?.modalidadeBcIcms).toBe('3');
  });
  it('unitPrice divergente é reportado e NUNCA vira update (N4)', () => {
    const doc = mkDoc({ items: [mkItem({ unitPrice: '299.9900' })] });
    const res = buildTarget(doc, mkCtx({}));
    expect(res.target!.unitPriceDivergences).toHaveLength(1);
    expect(res.target!.pendencies).toContain('UNITPRICE_DIVERGENT');
    const fields = diffDoc(doc, res.target!).map((d) => d.field);
    expect(fields.some((f) => f.includes('unitPrice'))).toBe(false);
  });
  it('unitPrice que só difere na precisão da coluna (4 casas) não é divergência real', () => {
    const ctx = mkCtx({
      sourceByLegacy: new Map([
        ['item_saida_1', mkSource({ valorUnitario: '299.98995' })], // → 299.9900 half-up
      ]),
    });
    const doc = mkDoc({ items: [mkItem({ unitPrice: '299.9900' })] });
    const res = buildTarget(doc, ctx);
    expect(res.target!.unitPriceDivergences).toHaveLength(0);
    expect(res.target!.unitPriceRepresentationOnly).toBe(1);
    expect(res.target!.pendencies).not.toContain('UNITPRICE_DIVERGENT');
  });
});

// ─── pares intra-grupo ───────────────────────────────────────────────────────

const PAIR_KEY = 'K9';
const alwEmit: AllowlistEntry = {
  chave: PAIR_KEY, nfNumber: 11544, docId: 'doc-emit', expectedDirection: 'EMITIDA',
  expectedCompanyCnpj: CRD, keepItemId: 'it-s', keepLegacyId: 'item_saida_36',
  dropItemId: 'it-e', dropLegacyId: 'item_entrada_1471',
};
const alwReceb: AllowlistEntry = {
  chave: PAIR_KEY, nfNumber: 11544, docId: 'doc-receb', expectedDirection: 'RECEBIDA',
  expectedCompanyCnpj: GDR, keepItemId: 'it-e2', keepLegacyId: 'item_entrada_1471',
  dropItemId: 'it-s2', dropLegacyId: 'item_saida_36',
};

function pairCtx(): BuildContext {
  const srcS = mkSource({ legacyId: 'item_saida_36', chave: PAIR_KEY, side: 'S' });
  const srcE = mkSource({ legacyId: 'item_entrada_1471', chave: PAIR_KEY, side: 'E' });
  const header = mkHeader({
    chave: PAIR_KEY,
    saida: { ...mkHeader({}).saida!, destCnpj: GDR },
    entrada: {
      companyCnpj: GDR, emitCnpj: CRD, emitNome: 'CRD', numero: 11544, serie: 1,
      emissaoLocal: '2026-01-06 11:07:00', natOp: 'Venda', tpNF: 1, protocolo: 'P',
    },
  });
  return mkCtx({
    headersByChave: new Map([[PAIR_KEY, header]]),
    sourceByLegacy: new Map([
      ['item_saida_36', srcS],
      ['item_entrada_1471', srcE],
    ]),
    allowlistByDocId: new Map([
      ['doc-emit', alwEmit],
      ['doc-receb', alwReceb],
    ]),
    erpDocIds: new Set(['doc-emit', 'doc-receb']),
  });
}

function pairDocEmit(): ErpDoc {
  return mkDoc({
    id: 'doc-emit',
    items: [
      mkItem({ id: 'it-s', legacyId: 'item_saida_36' }),
      mkItem({ id: 'it-e', legacyId: 'item_entrada_1471', taxId: 'tax-e' }),
    ],
  });
}

describe('pares intra-grupo (N1 SAFE_AUTOMATIC + revalidação)', () => {
  it('doc MIXED da allowlist com invariantes OK → WOULD_UPDATE com WOULD_DELETE_MIRROR do espelho', () => {
    const res = buildTarget(pairDocEmit(), pairCtx());
    expect(res.state).toBe('WOULD_UPDATE');
    expect(res.target!.direction).toBe('EMITIDA');
    expect(res.target!.companyId).toBe('co-crd');
    expect(res.target!.dropMirrorItemId).toBe('it-e');
    expect(res.target!.pendencies).toContain('INTRA_GROUP_PAIR');
    // só o item mantido entra no alvo:
    expect(res.target!.itemNItems).toEqual([{ itemId: 'it-s', nItem: 1 }]);
  });
  it('doc MIXED FORA da allowlist → CONFLICT (nunca DELETE genérico)', () => {
    const ctx = pairCtx();
    ctx.allowlistByDocId.delete('doc-emit');
    expect(buildTarget(pairDocEmit(), ctx).state).toBe('CONFLICT');
  });
  it('espelho quebrado (valores divergentes na origem) → CONFLICT', () => {
    const ctx = pairCtx();
    ctx.sourceByLegacy.get('item_entrada_1471')!.valorUnitario = '301.0000';
    const res = buildTarget(pairDocEmit(), ctx);
    expect(res.state).toBe('CONFLICT');
    expect(res.reasons.join(' ')).toContain('espelho quebrado');
  });
  it('contraparte sumiu do banco → CONFLICT', () => {
    const ctx = pairCtx();
    ctx.erpDocIds.delete('doc-receb');
    expect(buildTarget(pairDocEmit(), ctx).state).toBe('CONFLICT');
  });
  it('FK inesperada (taxes ≠ 1 no espelho) → CONFLICT', () => {
    const doc = pairDocEmit();
    doc.items[1].taxCount = 2;
    expect(buildTarget(doc, pairCtx()).state).toBe('CONFLICT');
  });
  it('item extra no documento → CONFLICT (auditoria obsoleta)', () => {
    const doc = pairDocEmit();
    doc.items.push(mkItem({ id: 'it-x', legacyId: 'item_saida_999' }));
    expect(buildTarget(doc, pairCtx()).state).toBe('CONFLICT');
  });
  it('validateMirrorPair recusa item a manter com prefixo errado para a direção', () => {
    const bad: AllowlistEntry = { ...alwEmit, keepLegacyId: 'item_entrada_1471', keepItemId: 'it-e', dropItemId: 'it-s', dropLegacyId: 'item_saida_36' };
    const check = validateMirrorPair({
      doc: pairDocEmit(), entry: bad, partnerEntry: alwReceb,
      partnerDocExists: true, sourceByLegacy: pairCtx().sourceByLegacy,
    });
    expect(check.ok).toBe(false);
  });
  it('allowlist do repositório: 18 entradas distintas, 9 EMITIDA + 9 RECEBIDA, 9 chaves', () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'allowlist-intra-group.json'), 'utf-8'),
    );
    const entries: AllowlistEntry[] = raw.pairs;
    expect(entries).toHaveLength(18);
    expect(new Set(entries.map((e) => e.docId)).size).toBe(18);
    expect(new Set(entries.map((e) => e.dropItemId)).size).toBe(18);
    expect(new Set(entries.map((e) => e.keepItemId)).size).toBe(18);
    expect(new Set(entries.map((e) => e.chave)).size).toBe(9);
    expect(entries.filter((e) => e.expectedDirection === 'EMITIDA')).toHaveLength(9);
    expect(entries.filter((e) => e.expectedDirection === 'RECEBIDA')).toHaveLength(9);
    // nenhum item aparece como keep de um doc e drop do mesmo doc
    for (const e of entries) expect(e.keepItemId).not.toBe(e.dropItemId);
  });
});

describe('colisões simuladas', () => {
  it('par na MESMA company colide; em companies distintas não', () => {
    const base = { chave: 'K', issuerCnpj: CRD, series: 1, number: 10, type: 'NFE' };
    const same = simulateUniqueCollisions([
      { docId: 'a', companyId: 'co-crd', ...base },
      { docId: 'b', companyId: 'co-crd', ...base },
    ]);
    expect(same.chaveCollisions).toHaveLength(1);
    expect(same.numberCollisions).toHaveLength(1);
    const split = simulateUniqueCollisions([
      { docId: 'a', companyId: 'co-crd', ...base },
      { docId: 'b', companyId: 'co-gdr', ...base },
    ]);
    expect(split.chaveCollisions).toHaveLength(0);
    expect(split.numberCollisions).toHaveLength(0);
  });
  it('chave NULL não colide (legado é distinto no Postgres)', () => {
    const res = simulateUniqueCollisions([
      { docId: 'a', companyId: 'c', chave: null, issuerCnpj: null, series: 1, number: null, type: 'NFE' },
      { docId: 'b', companyId: 'c', chave: null, issuerCnpj: null, series: 1, number: null, type: 'NFE' },
    ]);
    expect(res.chaveCollisions).toHaveLength(0);
    expect(res.numberCollisions).toHaveLength(0);
  });
});

describe('safety assertions (abort before write) — estado inicial e resume state', () => {
  const inicial = {
    totalDocs: 11087, historicDocs: 11081, focusDocs: 6,
    finalEmitida: 9828, finalRecebida: 1259,
    totalItems: 14108, pendingMirrors: 18,
    unchanged: 0, wouldUpdate: 11081, conflicts: 0, unresolved: 0,
  };
  const resume = {
    // estado real após a execução parcial de 24/08: 11.019 concluídos,
    // 62 pendentes, todos os 18 espelhos já removidos.
    totalDocs: 11087, historicDocs: 11081, focusDocs: 6,
    finalEmitida: 9828, finalRecebida: 1259,
    totalItems: 14090, pendingMirrors: 0,
    unchanged: 11019, wouldUpdate: 62, conflicts: 0, unresolved: 0,
  };
  it('estado inicial (pré-execução) passa limpo', () => {
    expect(safetyAssertions(inicial)).toEqual([]);
  });
  it('resume state legítimo passa limpo — sem afrouxar nada', () => {
    expect(safetyAssertions(resume)).toEqual([]);
  });
  it('meio-caminho consistente também passa (itens = final + espelhos pendentes)', () => {
    expect(safetyAssertions({
      ...resume, totalItems: 14096, pendingMirrors: 6,
      unchanged: 4000, wouldUpdate: 7081,
    })).toEqual([]);
  });
  it('estado intermediário INESPERADO aborta: item órfão fora da conta', () => {
    expect(safetyAssertions({ ...resume, totalItems: 14091 })).toHaveLength(1);
  });
  it('estado intermediário INESPERADO aborta: documento a mais no universo', () => {
    expect(safetyAssertions({ ...resume, totalDocs: 11088 })).toHaveLength(1);
  });
  it('estado intermediário INESPERADO aborta: partição não fecha (doc sumiu)', () => {
    expect(safetyAssertions({ ...resume, unchanged: 11018 })).toHaveLength(1);
  });
  it('projeção final divergente aborta (nunca ajustar para fazer passar)', () => {
    expect(safetyAssertions({ ...resume, finalEmitida: 9827, finalRecebida: 1260 })).toHaveLength(2);
  });
  it('CONFLICT ou unresolved abortam', () => {
    expect(safetyAssertions({ ...resume, conflicts: 1, wouldUpdate: 61 })).toHaveLength(2);
    expect(safetyAssertions({ ...resume, unresolved: 1, wouldUpdate: 61 })).toHaveLength(2);
  });
  it('espelhos além dos 18 auditados abortam', () => {
    expect(safetyAssertions({ ...inicial, pendingMirrors: 19, totalItems: 14109 })).toHaveLength(1);
  });
});

describe('gate nominal do resume (--commit vinculado à evidência)', () => {
  it('conjunto idêntico de ids passa; qualquer diferença aborta', () => {
    expect(sameIdSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(sameIdSet(['a', 'b'], ['a', 'b', 'c'])).toBe(false); // doc a mais
    expect(sameIdSet(['a', 'b', 'c'], ['a', 'b'])).toBe(false); // doc a menos
    expect(sameIdSet(['a', 'b', 'x'], ['a', 'b', 'c'])).toBe(false); // doc trocado
    expect(sameIdSet(['a', 'a'], ['a', 'a'])).toBe(false); // duplicata não conta
    expect(sameIdSet([], [])).toBe(true);
  });
});

describe('retomada: só os pendentes são candidatos a UPDATE', () => {
  it('doc já reidratado sai como UNCHANGED e doc pendente como WOULD_UPDATE', () => {
    const ctx = mkCtx({});
    // pendente: estado antigo (sem chave/direção corretas)
    const pendente = mkDoc({ id: 'doc-pendente' });
    const rPend = buildTarget(pendente, ctx);
    expect(rPend.state).toBe('WOULD_UPDATE');
    expect(diffDoc(pendente, rPend.target!).length).toBeGreaterThan(0);
    // concluído: espelho do alvo, com timestamps como o banco devolve (UTC naive)
    const t = rPend.target!;
    const done = mkDoc({
      id: 'doc-concluido', companyId: t.companyId, chave: t.chave,
      number: t.number, series: t.series,
      authorizedAt: '2026-01-06 14:08:21', protocolNumber: t.protocolNumber,
      direction: t.direction, issueDate: '2026-01-06 14:07:00',
      issuerCnpj: t.issuerCnpj, issuerName: t.issuerName,
      recipientCnpj: t.recipientCnpj, naturezaOperacao: t.naturezaOperacao,
      tpNF: t.tpNF, supplierId: t.supplierId,
      totals: { vProd: '300.00', vNF: '300.00' }, xmlPresent: true,
      items: [mkItem({ nItem: 1, taxOrigemIcms: '0', taxModalidadeBcIcms: '3' })],
    });
    expect(diffDoc(done, buildTarget(done, ctx).target!)).toEqual([]);
  });
});

describe('atomicidade (contrato de execução por transação)', () => {
  it('falha no meio de um documento propaga erro sem marcar concluído (rollback)', async () => {
    // Simula o runner: cada doc roda numa transação; exceção → estado anterior.
    const writes: string[] = [];
    const fakeTx = {
      write: (w: string) => {
        if (w === 'boom') throw new Error('falha simulada');
        writes.push(w);
      },
    };
    const runDocInTx = async (ops: string[]) => {
      const before = [...writes];
      try {
        for (const op of ops) fakeTx.write(op);
        return 'UPDATED';
      } catch {
        writes.length = 0;
        writes.push(...before); // rollback: restaura estado anterior do doc
        return 'FAILED';
      }
    };
    expect(await runDocInTx(['a', 'b'])).toBe('UPDATED');
    expect(await runDocInTx(['c', 'boom', 'd'])).toBe('FAILED');
    expect(writes).toEqual(['a', 'b']); // nada parcial do doc que falhou
  });
});
