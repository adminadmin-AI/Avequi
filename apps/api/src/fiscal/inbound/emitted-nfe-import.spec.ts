/**
 * Importação canônica de NF-e EMITIDA (histórico do emissor anterior).
 *
 * Princípio testado aqui: importar uma NF-e histórica NÃO é realizar uma venda
 * hoje — o plano reconstrói o documento fiscal e nada mais.
 */
import { parseNfeDocument, ParsedNfe } from '../nfe-xml/nfe-proc.parser';
import { CHAVE, CNPJ_DEST, CNPJ_EMIT, ITEM_IBSCBS, ITEM_SAIDA_SEM_IBSCBS, eventoXml, inutXml, nfeXml } from '../nfe-xml/nfe-fixtures';
import {
  ExistingDoc,
  ImportContext,
  ImportOptions,
  buildTargetFromNfe,
  nominalEvidence,
  planBatch,
  resolveCustomer,
} from './received-nfe-import-core';
import { applyPlan, parseFileContent, planFromXml, toCreateData } from './received-nfe-import-writer';

// Na fixture padrão o EMITENTE é CNPJ_EMIT e o DESTINATÁRIO é CNPJ_DEST.
// Para EMITIDA, a company do ERP é o emitente: CRD = CNPJ_EMIT.
const CRD = { id: 'co-crd', name: 'CRD', cnpj: CNPJ_EMIT };
const GDR = { id: 'co-gdr', name: 'GDR', cnpj: CNPJ_DEST }; // destinatário da fixture = outra company do grupo
const TERCEIRO = '55555555000155';
const CUSTOMER_CRD = { id: 'cu-1', companyId: 'co-crd', document: '55.555.555/0001-55' }; // formatado de propósito
const EMITIDA: ImportOptions = { direction: 'EMITIDA' };

function ctx(over: Partial<ImportContext> = {}): ImportContext {
  return {
    companies: [CRD, GDR],
    suppliers: [],
    customers: [CUSTOMER_CRD],
    existingByChave: new Map(),
    eventsByChave: new Map(),
    ...over,
  };
}

function parsed(o: Parameters<typeof nfeXml>[0] = {}): ParsedNfe {
  const d = parseNfeDocument(nfeXml({ destCnpj: TERCEIRO, items: ITEM_SAIDA_SEM_IBSCBS, vNF: '4500.00', ...o }));
  if (d.kind !== 'NFE') throw new Error('fixture');
  return d;
}

function existingEmitida(over: Partial<ExistingDoc> = {}): ExistingDoc {
  return {
    id: 'doc-e1',
    companyId: 'co-crd',
    direction: 'EMITIDA',
    status: 'AUTHORIZED',
    type: 'NFE',
    chave: CHAVE,
    issuerCnpj: CNPJ_EMIT,
    number: 12345,
    series: 1,
    vNF: '4500.00',
    supplierId: null,
    xmlPresent: true,
    cancelledAt: null,
    items: [{ id: 'it-1', nItem: 1, productCode: 'MOD-CAR-003', quantity: '1.0000', unitPrice: '4500.0000', totalPrice: '4500.0000' }],
    ...over,
  };
}

describe('EMITIDA — company = emitente (fail-closed), destinatário preservado', () => {
  it('1. XML emitido pela CRD ⇒ FiscalDocument EMITIDA da CRD, com destinatário e impostos do XML', () => {
    const plan = buildTargetFromNfe(parsed(), ctx(), EMITIDA);
    expect(plan.state).toBe('INSERT');
    expect(plan.companyId).toBe('co-crd');
    const t = plan.target!;
    expect(t).toMatchObject({
      direction: 'EMITIDA', type: 'NFE', status: 'AUTHORIZED', chave: CHAVE, number: 12345, series: 1,
      issuerCnpj: CNPJ_EMIT, issuerName: 'FORNECEDOR FICTICIO LTDA', recipientCnpj: TERCEIRO,
      supplierId: null, tpNF: 1, issueDate: '2026-06-15T09:59:00-03:00', authorizedAt: '2026-06-15T10:00:05-03:00', protocolNumber: '141260000000001',
    });
    expect(t.items[0]).toMatchObject({ nItem: 1, productCode: 'MOD-CAR-003', ncm: '87163900', cfop: '6101', quantity: '1.0000', totalPrice: '4500.00' });
    // 8. impostos existentes preservados exatamente
    expect(t.items[0].tax).toMatchObject({ cstIcms: '00', aliquotaIcms: '12.0000', valorIcms: '540.00', cstIpi: '51', cstPis: '49', cstCofins: '99', aliquotaPis: '0.0000' });
    expect(plan.pendencies).toEqual(expect.arrayContaining(['IBSCBS_ABSENT']));
    expect(plan.pendencies).not.toContain('SUPPLIER_MISSING');
  });

  it('2. XML emitido pela GDR ⇒ documento EMITIDA da GDR (nunca da CRD)', () => {
    const plan = buildTargetFromNfe(parsed({ emitCnpj: CNPJ_DEST, destCnpj: TERCEIRO }), ctx(), EMITIDA);
    expect(plan.state).toBe('INSERT');
    expect(plan.companyId).toBe('co-gdr');
    expect(plan.target!.issuerCnpj).toBe(CNPJ_DEST);
  });

  it('5. emitente que não é company do ERP ⇒ SKIPPED com o CNPJ no motivo — nunca fallback, nunca escreve', () => {
    const plan = buildTargetFromNfe(parsed({ emitCnpj: TERCEIRO }), ctx(), EMITIDA);
    expect(plan.state).toBe('SKIPPED');
    expect(plan.companyId).toBeNull();
    expect(plan.target).toBeNull();
    expect(plan.reasons[0]).toMatch(/company desconhecida/);
  });

  it('CNPJ do emitente em duas companies ⇒ CONFLICT (ambiguidade nunca resolvida por escolha)', () => {
    const plan = buildTargetFromNfe(parsed(), ctx({ companies: [CRD, { ...CRD, id: 'co-crd-2' }] }), EMITIDA);
    expect(plan.state).toBe('CONFLICT');
  });

  it('a mesma fixture lida como RECEBIDA continua igual (default preservado): company = destinatário', () => {
    const plan = buildTargetFromNfe(parsed({ destCnpj: CNPJ_DEST }), ctx());
    expect(plan.target!.direction).toBe('RECEBIDA');
    expect(plan.companyId).toBe('co-gdr');
  });
});

describe('EMITIDA — destinatário / Customer (só cobertura; nunca cria)', () => {
  it('6. destinatário com Customer único na company ⇒ customerId informativo; nada é gravado a partir dele', () => {
    const plan = buildTargetFromNfe(parsed(), ctx(), EMITIDA);
    expect(plan.customerId).toBe('cu-1');
    expect(plan.pendencies).not.toContain('CUSTOMER_MISSING');
    expect(Object.keys(toCreateData(plan.target!, '<x/>'))).not.toContain('customerId');
  });

  it('7. destinatário sem Customer ⇒ documento válido, vínculo nulo, pendência explícita', () => {
    const plan = buildTargetFromNfe(parsed(), ctx({ customers: [] }), EMITIDA);
    expect(plan.state).toBe('INSERT');
    expect(plan.customerId).toBeNull();
    expect(plan.pendencies).toContain('CUSTOMER_MISSING');
    expect(plan.target!.recipientCnpj).toBe(TERCEIRO);
  });

  it('Customer só conta na company emitente; documento formatado ≠ dígitos não impede o match exato', () => {
    expect(resolveCustomer(TERCEIRO, 'co-gdr', [CUSTOMER_CRD]).kind).toBe('NONE');
    expect(resolveCustomer(TERCEIRO, 'co-crd', [CUSTOMER_CRD]).kind).toBe('ONE');
    expect(resolveCustomer(TERCEIRO, 'co-crd', [CUSTOMER_CRD, { ...CUSTOMER_CRD, id: 'cu-2', document: TERCEIRO }]).kind).toBe('AMBIGUOUS');
    const plan = buildTargetFromNfe(parsed(), ctx({ customers: [CUSTOMER_CRD, { ...CUSTOMER_CRD, id: 'cu-2', document: TERCEIRO }] }), EMITIDA);
    expect(plan.state).toBe('INSERT');
    expect(plan.customerId).toBeNull();
    expect(plan.pendencies).toContain('CUSTOMER_AMBIGUOUS');
  });

  it('destinatário pessoa física (CPF) é preservado; sem CNPJ/CPF ⇒ RECIPIENT_UNIDENTIFIED, documento ainda válido', () => {
    const pf = buildTargetFromNfe(parsed({ destCpf: '12345678909' }), ctx(), EMITIDA);
    expect(pf.state).toBe('INSERT');
    expect(pf.target!.recipientCnpj).toBe('12345678909');
    const anon = buildTargetFromNfe(parsed({ destUnidentified: true }), ctx(), EMITIDA);
    expect(anon.state).toBe('INSERT');
    expect(anon.target!.recipientCnpj).toBeNull();
    expect(anon.pendencies).toContain('RECIPIENT_UNIDENTIFIED');
  });
});

describe('EMITIDA — idempotência, intra-grupo e conflito', () => {
  it('3. mesma chave já existente e coerente ⇒ UNCHANGED (reexecução não escreve)', () => {
    const plan = buildTargetFromNfe(parsed(), ctx({ existingByChave: new Map([[CHAVE, [existingEmitida()]]]) }), EMITIDA);
    expect(plan.state).toBe('UNCHANGED');
    expect(plan.update).toBeNull();
    expect(plan.existingDocId).toBe('doc-e1');
  });

  it('UPDATE legítimo só para XML ausente / cancelamento registrado — nunca supplierId em EMITIDA', () => {
    const plan = buildTargetFromNfe(parsed(), ctx({ existingByChave: new Map([[CHAVE, [existingEmitida({ xmlPresent: false })]]]) }), EMITIDA);
    expect(plan.state).toBe('UPDATE');
    expect(plan.update).toEqual({ docId: 'doc-e1', xml: true });
  });

  it('4. intra-grupo: CRD emite para GDR ⇒ CRD EMITIDA + GDR RECEBIDA com a MESMA chave são válidos e independentes', () => {
    const xml = nfeXml({ emitCnpj: CNPJ_EMIT, destCnpj: CNPJ_DEST, items: ITEM_SAIDA_SEM_IBSCBS, vNF: '4500.00' });
    const asEmitida = planFromXml(xml, ctx(), EMITIDA)!;
    const asRecebida = planFromXml(xml, ctx())!;
    expect(asEmitida).toMatchObject({ state: 'INSERT', companyId: 'co-crd' });
    expect(asEmitida.target!.direction).toBe('EMITIDA');
    expect(asEmitida.pendencies).toContain('INTRA_GROUP');
    expect(asRecebida).toMatchObject({ state: 'INSERT', companyId: 'co-gdr' });
    expect(asRecebida.target!.direction).toBe('RECEBIDA');
    expect(asRecebida.pendencies).toContain('INTRA_GROUP');

    // O documento RECEBIDA da GDR já existir NÃO conta como existente para a CRD (unicidade por company)
    const gdrRecebida = existingEmitida({ id: 'doc-gdr', companyId: 'co-gdr', direction: 'RECEBIDA', supplierId: 'sup-x' });
    const again = buildTargetFromNfe(parsed({ destCnpj: CNPJ_DEST }), ctx({ existingByChave: new Map([[CHAVE, [gdrRecebida]]]) }), EMITIDA);
    expect(again.state).toBe('INSERT');
    expect(again.companyId).toBe('co-crd');
    // Evidência nominal separa as duas companies
    const ev = nominalEvidence([asEmitida, asRecebida]);
    expect(ev.insert).toEqual([`co-crd|${CHAVE}`, `co-gdr|${CHAVE}`]);
  });

  it('16. mesma chave na MESMA company com direção diferente ou fato fiscal divergente ⇒ CONFLICT, nunca absorve', () => {
    const wrongDir = buildTargetFromNfe(parsed(), ctx({ existingByChave: new Map([[CHAVE, [existingEmitida({ direction: 'RECEBIDA' })]]]) }), EMITIDA);
    expect(wrongDir.state).toBe('CONFLICT');
    expect(wrongDir.reasons[0]).toMatch(/existente é RECEBIDA.*EMITIDA/);
    const wrongNumber = buildTargetFromNfe(parsed(), ctx({ existingByChave: new Map([[CHAVE, [existingEmitida({ number: 99 })]]]) }), EMITIDA);
    expect(wrongNumber.state).toBe('CONFLICT');
    const wrongTotal = buildTargetFromNfe(parsed(), ctx({ existingByChave: new Map([[CHAVE, [existingEmitida({ vNF: '1.00' })]]]) }), EMITIDA);
    expect(wrongTotal.state).toBe('CONFLICT');
    // chave inconsistente entre Id e protocolo ⇒ INVALID
    expect(buildTargetFromNfe(parsed({ chNFeProt: '41260611111111000191550010000123451000099999' }), ctx(), EMITIDA).state).toBe('INVALID');
  });
});

describe('EMITIDA — IBS/CBS exatamente como no XML', () => {
  it('9. NF-e sem grupo IBS/CBS ⇒ impostos IBS/CBS nulos (nada inferido: sem CST, sem cClassTrib, sem 0,1/0,9) + pendência consultável', () => {
    const plan = buildTargetFromNfe(parsed(), ctx(), EMITIDA);
    const tax = plan.target!.items[0].tax!;
    expect(tax).toMatchObject({ cstCbs: null, cClassTrib: null, aliquotaCbs: null, valorCbs: null, aliquotaIbsUf: null, valorIbsUf: null, cstIbsUf: null, cstIbsMun: null });
    expect(plan.target!.totals.vIBS).toBeUndefined();
    expect(plan.target!.totals.vCBS).toBeUndefined();
    expect(plan.pendencies).toContain('IBSCBS_ABSENT');
    const data = toCreateData(plan.target!, '<x/>') as any;
    expect(data.vIBS).toBeUndefined();
    expect(data.items.create[0].taxes.create[0].cstCbs).toBeNull();
  });

  it('10. NF-e COM grupo IBS/CBS ⇒ grupo e totais preservados', () => {
    const plan = buildTargetFromNfe(parsed({ items: ITEM_IBSCBS, withIbsCbsTot: true, vNF: '3000.00' }), ctx(), EMITIDA);
    expect(plan.target!.items[0].tax).toMatchObject({ cstCbs: '000', cClassTrib: '000001', baseCbs: '3000.00', aliquotaCbs: '0.9000', valorCbs: '27.00', aliquotaIbsUf: '0.1000', valorIbsUf: '3.00', aliquotaIbsMun: '0.0000', valorIbsMun: '0.00' });
    expect(plan.target!.totals).toMatchObject({ vIBS: '3.00', vCBS: '27.00' });
    expect(plan.pendencies).not.toContain('IBSCBS_ABSENT');
    expect((toCreateData(plan.target!, '<x/>') as any).vCBS).toBe('27.00');
  });
});

describe('EMITIDA — nenhum efeito operacional', () => {
  it('11/12/13/14/15. escrita só toca fiscalDocument: sem SalesOrder, estoque, título, evento, numeração ou Focus', async () => {
    const plan = buildTargetFromNfe(parsed(), ctx(), EMITIDA);
    const data = toCreateData(plan.target!, '<xml/>') as Record<string, unknown>;
    for (const forbidden of ['salesOrderId', 'salesOrder', 'storeTransferId', 'focusRef', 'financialEntry', 'referencedDocumentId', 'customerId', 'stockMovement', 'danfeUrl', 'xmlUrl']) {
      expect(data).not.toHaveProperty(forbidden);
    }
    // número/série vêm do XML histórico, não de contador do ERP/Focus
    expect(data).toMatchObject({ number: 12345, series: 1, chave: CHAVE, direction: 'EMITIDA', status: 'AUTHORIZED', xml: '<xml/>' });

    // O escritor só tem acesso a fiscalDocument.create/update — qualquer outra tabela é inexistente no tipo.
    const touched: string[] = [];
    const tx = new Proxy({} as any, {
      get(_t, model: string) {
        touched.push(model);
        return { create: async () => ({ id: 'new' }), update: async (args: any) => ({ id: args.where.id }) };
      },
    });
    const r = await applyPlan(tx, plan, '<xml/>');
    expect(r).toEqual({ id: 'new', action: 'INSERT' });
    expect([...new Set(touched)]).toEqual(['fiscalDocument']);
  });
});

describe('EMITIDA — lote: cancelamento, inutilização, duplicatas', () => {
  it('17. cancelamento registrado (110111 cStat 135) no lote ⇒ importa como CANCELLED, com data e justificativa', () => {
    const files = [
      parseFileContent('saida/nfe.xml', nfeXml({ destCnpj: TERCEIRO, items: ITEM_SAIDA_SEM_IBSCBS, vNF: '4500.00' })),
      parseFileContent('saida/nfe_110111.xml', eventoXml({ tpEvento: '110111', xJust: 'DUPLICIDADE DE EMISSAO' })),
    ];
    const r = planBatch(files, ctx(), EMITIDA);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].target).toMatchObject({ status: 'CANCELLED', cancelledAt: '2026-06-16T07:59:00-03:00', cancellationJustification: 'DUPLICIDADE DE EMISSAO' });
    // cancelamento sem registro (cStat ≠ 135/155) não cancela
    const r2 = planBatch([files[0], parseFileContent('e.xml', eventoXml({ tpEvento: '110111', cStat: '573' }))], ctx(), EMITIDA);
    expect(r2.plans[0].target!.status).toBe('AUTHORIZED');
    expect(r2.plans[0].pendencies).toContain('CANCEL_EVENT_UNREGISTERED');
  });

  it('cancelamento já CANCELLED no ERP ⇒ UNCHANGED; AUTHORIZED no ERP + evento registrado ⇒ UPDATE (nunca reverte cancelamento)', () => {
    const ev = new Map([[CHAVE, [parseNfeDocument(eventoXml({ tpEvento: '110111' })) as any]]]);
    const upd = buildTargetFromNfe(parsed(), ctx({ eventsByChave: ev, existingByChave: new Map([[CHAVE, [existingEmitida()]]]) }), EMITIDA);
    expect(upd.state).toBe('UPDATE');
    expect(upd.update!.cancel).toBeTruthy();
    const same = buildTargetFromNfe(parsed(), ctx({ eventsByChave: ev, existingByChave: new Map([[CHAVE, [existingEmitida({ status: 'CANCELLED' })]]]) }), EMITIDA);
    expect(same.state).toBe('UNCHANGED');
  });

  it('inutilização (procInutNFe) é classificada e reportada — nunca vira plano nem toca FiscalVoidRange', () => {
    const r = planBatch([parseFileContent('Inut_x.xml', inutXml({ ini: 14517, fin: 15516 }))], ctx(), EMITIDA);
    expect(r.plans).toHaveLength(0);
    expect(r.unknownFiles).toHaveLength(0);
    expect(r.inutilizacoes).toHaveLength(1);
    expect(r.inutilizacoes[0].inut).toMatchObject({ kind: 'INUT', cnpj: CNPJ_EMIT, serie: 1, nNFIni: 14517, nNFFin: 15516, ret: { cStat: '102', nProt: '141260000000009' } });
    expect(planFromXml(inutXml({ ini: 1, fin: 2 }), ctx(), EMITIDA)).toBeNull();
  });

  it('mesmo XML em duas pastas ⇒ um plano; conteúdo divergente ⇒ CONFLICT', () => {
    const a = nfeXml({ destCnpj: TERCEIRO, items: ITEM_SAIDA_SEM_IBSCBS, vNF: '4500.00' });
    const r = planBatch([parseFileContent('Autorizadas/a.xml', a), parseFileContent('Canceladas/a.xml', a)], ctx(), EMITIDA);
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].state).toBe('INSERT');
    expect(r.duplicateChaves[0].divergent).toBe(false);
    const r2 = planBatch([parseFileContent('1.xml', a), parseFileContent('2.xml', nfeXml({ destCnpj: TERCEIRO, items: ITEM_SAIDA_SEM_IBSCBS, vNF: '4501.00' }))], ctx(), EMITIDA);
    expect(r2.plans[0].state).toBe('CONFLICT');
  });
});
