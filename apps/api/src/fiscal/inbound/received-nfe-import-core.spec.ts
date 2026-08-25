import { parseNfeDocument, ParsedNfe, ParsedEvento } from '../nfe-xml/nfe-proc.parser';
import { CHAVE, CNPJ_DEST, CNPJ_EMIT, eventoXml, nfeXml } from '../nfe-xml/nfe-fixtures';
import {
  ExistingDoc,
  ImportContext,
  buildTargetFromNfe,
  compareExisting,
  mapItemTax,
  nominalEvidence,
  planBatch,
  summarizeEvents,
} from './received-nfe-import-core';
import { applyPlan, parseFileContent, planFromXml, toCreateData, toUpdateData } from './received-nfe-import-writer';

const COMPANY_CRD = { id: 'co-crd', name: 'CRD', cnpj: CNPJ_DEST };
const COMPANY_GDR = { id: 'co-gdr', name: 'GDR', cnpj: '33333333000153' };
const SUPPLIER = { id: 'sup-1', companyId: 'co-crd', cnpj: CNPJ_EMIT };

function ctx(over: Partial<ImportContext> = {}): ImportContext {
  return {
    companies: [COMPANY_CRD, COMPANY_GDR],
    suppliers: [SUPPLIER],
    existingByChave: new Map(),
    eventsByChave: new Map(),
    ...over,
  };
}

function parsedNfe(o: Parameters<typeof nfeXml>[0] = {}): ParsedNfe {
  const d = parseNfeDocument(nfeXml(o));
  if (d.kind !== 'NFE') throw new Error('fixture');
  return d;
}

function parsedEvento(o: Parameters<typeof eventoXml>[0]): ParsedEvento {
  const d = parseNfeDocument(eventoXml(o));
  if (d.kind !== 'EVENTO') throw new Error('fixture');
  return d;
}

/** Documento existente coerente com a fixture padrão (como ficaria após um INSERT). */
function existingFromFixture(over: Partial<ExistingDoc> = {}): ExistingDoc {
  return {
    id: 'doc-1',
    companyId: 'co-crd',
    direction: 'RECEBIDA',
    status: 'AUTHORIZED',
    type: 'NFE',
    chave: CHAVE,
    issuerCnpj: CNPJ_EMIT,
    number: 12345,
    series: 1,
    vNF: '5318.08',
    supplierId: 'sup-1',
    xmlPresent: true,
    cancelledAt: null,
    items: [
      { id: 'it-1', nItem: 1, productCode: '8429', quantity: '1217.0000', unitPrice: '4.1500', totalPrice: '5050.5500' },
      { id: 'it-2', nItem: 2, productCode: 'A-77', quantity: '10.0000', unitPrice: '1.5000', totalPrice: '15.0000' },
    ],
    ...over,
  };
}

describe('buildTargetFromNfe — INSERT canônico', () => {
  it('monta FiscalDocument RECEBIDA + itens + impostos a partir do XML', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx());
    expect(plan.state).toBe('INSERT');
    expect(plan.companyId).toBe('co-crd'); // company = DESTINATÁRIO
    const t = plan.target!;
    expect(t).toMatchObject({
      type: 'NFE', direction: 'RECEBIDA', status: 'AUTHORIZED', finalidade: 'NORMAL', chave: CHAVE, number: 12345, series: 1,
      issueDate: '2026-06-15T09:59:00-03:00', authorizedAt: '2026-06-15T10:00:05-03:00', protocolNumber: '141260000000001',
      issuerCnpj: CNPJ_EMIT, issuerName: 'FORNECEDOR FICTICIO LTDA', recipientCnpj: CNPJ_DEST, naturezaOperacao: 'VENDA DE MERCADORIA',
      tpNF: 1, supplierId: 'sup-1', infCpl: 'PEDIDO 77 & 78 => ENTREGA', cancelledAt: null,
    });
    expect(t.totals).toEqual({ vProd: '5065.55', vFrete: '0.00', vSeg: '0.00', vDesc: '0.00', vOutro: '0.00', vIPI: '252.53', vICMS: '606.07', vICMSUFDest: '353.54', vFCPUFDest: '101.01', vPIS: '28.89', vCOFINS: '133.33', vNF: '5318.08' });
    expect(t.items).toHaveLength(2);
    expect(t.items[0]).toMatchObject({ nItem: 1, productCode: '8429', productName: 'CHAPA DE ACO 2 MM', ncm: '73089010', cest: '0104900', cfop: '6101', unit: 'KG', quantity: '1217.0000', unitPrice: '4.1500000000', totalPrice: '5050.55' });
    expect(t.items[0].tax).toMatchObject({
      origemIcms: '0', modalidadeBcIcms: '3', cstIcms: '00', baseIcms: '5050.55', aliquotaIcms: '12.0000', valorIcms: '606.07',
      cstIpi: '50', baseIpi: '5050.55', aliquotaIpi: '5.00', valorIpi: '252.53',
      cstPis: '01', basePis: '4444.48', aliquotaPis: '0.6500', valorPis: '28.89',
      cstCofins: '01', baseCofins: '4444.48', aliquotaCofins: '3.0000', valorCofins: '133.33',
      difalBase: '5050.55', difalAliqInterna: '19.00', difalAliqInterest: '12.00', difalValor: '353.54', difalFcpAliquota: '2.00', difalFcpValor: '101.01',
      cClassTrib: null, cstCbs: null,
    });
    // Simples: CSOSN vai para cstIcms (mesma convenção do histórico reidratado)
    expect(t.items[1].tax).toMatchObject({ origemIcms: '2', cstIcms: '102', baseIcms: null, cstIpi: '53', valorIpi: null, cstPis: '07', cstCofins: '07', difalBase: null });
    expect(plan.pendencies).toEqual([]);
  });

  it('finalidade mapeia finNFe (4 → DEVOLUCAO); item sem <imposto> fica sem tax', () => {
    const items = '<det nItem="1"><prod><cProd>X</cProd><xProd>P</xProd><qCom>1</qCom><vUnCom>1.00</vUnCom><vProd>1.00</vProd></prod></det>';
    const plan = buildTargetFromNfe(parsedNfe({ finNFe: '4', items }), ctx());
    expect(plan.target!.finalidade).toBe('DEVOLUCAO');
    expect(plan.target!.items[0].tax).toBeNull();
    expect(mapItemTax({ nItem: 1, cProd: null, cEAN: null, xProd: 'P', ncm: null, cest: null, cfop: null, uCom: null, qCom: '1', vUnCom: '1', vProd: '1', icms: null, ipi: null, pis: null, cofins: null, difal: null, ibsCbs: null })).toBeNull();
  });

  it('Supplier ausente: importa com supplierId=null e pendência explícita — NUNCA cria', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ suppliers: [] }));
    expect(plan.state).toBe('INSERT');
    expect(plan.target!.supplierId).toBeNull();
    expect(plan.pendencies).toContain('SUPPLIER_MISSING');
  });

  it('Supplier só conta dentro da company do destinatário', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ suppliers: [{ id: 'sup-gdr', companyId: 'co-gdr', cnpj: CNPJ_EMIT }] }));
    expect(plan.target!.supplierId).toBeNull();
    expect(plan.pendencies).toContain('SUPPLIER_MISSING');
  });

  it('Supplier duplicado na mesma company ⇒ CONFLICT', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ suppliers: [SUPPLIER, { ...SUPPLIER, id: 'sup-2' }] }));
    expect(plan.state).toBe('CONFLICT');
    expect(plan.reasons[0]).toMatch(/mais de um Supplier/);
  });

  it('emitente também company do ERP ⇒ INTRA_GROUP (importa como RECEBIDA do destinatário)', () => {
    const plan = buildTargetFromNfe(parsedNfe({ emitCnpj: COMPANY_GDR.cnpj }), ctx({ suppliers: [] }));
    expect(plan.state).toBe('INSERT');
    expect(plan.companyId).toBe('co-crd');
    expect(plan.pendencies).toEqual(expect.arrayContaining(['INTRA_GROUP', 'SUPPLIER_MISSING']));
  });
});

describe('buildTargetFromNfe — SKIPPED / INVALID', () => {
  it('destinatário que não é company ⇒ SKIPPED', () => {
    const plan = buildTargetFromNfe(parsedNfe({ destCnpj: '44444444000100' }), ctx());
    expect(plan.state).toBe('SKIPPED');
    expect(plan.reasons[0]).toMatch(/não é company/);
  });
  it('NFC-e (mod 65) e homologação ⇒ SKIPPED', () => {
    expect(buildTargetFromNfe(parsedNfe({ mod: '65' }), ctx()).state).toBe('SKIPPED');
    expect(buildTargetFromNfe(parsedNfe({ tpAmb: '2' }), ctx()).state).toBe('SKIPPED');
  });
  it('sem protocolo / não autorizada / chave inconsistente ⇒ INVALID', () => {
    expect(buildTargetFromNfe(parsedNfe({ withProt: false }), ctx()).state).toBe('INVALID');
    expect(buildTargetFromNfe(parsedNfe({ cStat: '301' }), ctx()).state).toBe('INVALID');
    expect(buildTargetFromNfe(parsedNfe({ chNFeProt: '41260611111111000191550010000123451000099999' }), ctx()).state).toBe('INVALID');
  });
});

describe('buildTargetFromNfe — idempotência, UPDATE legítimo e CONFLICT', () => {
  it('documento já existente e coerente ⇒ UNCHANGED (reexecução não escreve)', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ existingByChave: new Map([[CHAVE, [existingFromFixture()]]]) }));
    expect(plan.state).toBe('UNCHANGED');
    expect(plan.update).toBeNull();
    expect(plan.existingDocId).toBe('doc-1');
  });

  it('mesma chave em OUTRA company não conta como existente (unicidade é por company)', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ existingByChave: new Map([[CHAVE, [existingFromFixture({ companyId: 'co-gdr' })]]]) }));
    expect(plan.state).toBe('INSERT');
  });

  it('UPDATE legítimo: supplierId nulo → resolvido; XML ausente → preenchido', () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ existingByChave: new Map([[CHAVE, [existingFromFixture({ supplierId: null, xmlPresent: false })]]]) }));
    expect(plan.state).toBe('UPDATE');
    expect(plan.update).toEqual({ docId: 'doc-1', supplierId: 'sup-1', xml: true });
    expect(toUpdateData(plan, '<x/>')).toEqual({ supplierId: 'sup-1', xml: '<x/>' });
  });

  it('cancelamento registrado (110111 cStat 135) ⇒ INSERT como CANCELLED / UPDATE de existente', () => {
    const events = new Map([[CHAVE, [parsedEvento({ tpEvento: '110111' })]]]);
    const ins = buildTargetFromNfe(parsedNfe(), ctx({ eventsByChave: events }));
    expect(ins.state).toBe('INSERT');
    expect(ins.target).toMatchObject({ status: 'CANCELLED', cancelledAt: '2026-06-16T07:59:00-03:00', cancellationJustification: 'ERRO DE DIGITACAO NO PEDIDO' });

    const upd = buildTargetFromNfe(parsedNfe(), ctx({ eventsByChave: events, existingByChave: new Map([[CHAVE, [existingFromFixture()]]]) }));
    expect(upd.state).toBe('UPDATE');
    expect(upd.update?.cancel).toEqual({ cancelledAt: '2026-06-16T07:59:00-03:00', justification: 'ERRO DE DIGITACAO NO PEDIDO' });
    expect(toUpdateData(upd, '')).toEqual({ status: 'CANCELLED', cancelledAt: '2026-06-16T07:59:00-03:00', cancellationJustification: 'ERRO DE DIGITACAO NO PEDIDO' });

    // já CANCELLED no ERP ⇒ nada a fazer
    const same = buildTargetFromNfe(parsedNfe(), ctx({ eventsByChave: events, existingByChave: new Map([[CHAVE, [existingFromFixture({ status: 'CANCELLED' })]]]) }));
    expect(same.state).toBe('UNCHANGED');
  });

  it('evento de cancelamento NÃO registrado não cancela; CC-e e manifestação só reportam', () => {
    const s = summarizeEvents([
      parsedEvento({ tpEvento: '110111', cStat: '573' }),
      parsedEvento({ tpEvento: '110110' }),
      parsedEvento({ tpEvento: '210210' }),
    ]);
    expect(s.cancel).toBeNull();
    expect(s.cceCount).toBe(1);
    expect(s.pendencies.sort()).toEqual(['CANCEL_EVENT_UNREGISTERED', 'CCE_NOT_PERSISTED', 'MANIFEST_EVENT_IGNORED']);
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ eventsByChave: new Map([[CHAVE, [parsedEvento({ tpEvento: '110110' })]]]) }));
    expect(plan.target!.status).toBe('AUTHORIZED');
    expect(plan.pendencies).toContain('CCE_NOT_PERSISTED');
  });

  it('divergência de fato fiscal com o existente ⇒ CONFLICT, nunca UPDATE', () => {
    const cases: Array<[Partial<ExistingDoc>, RegExp]> = [
      [{ issuerCnpj: '99999999000199' }, /issuerCnpj/],
      [{ number: 1 }, /number/],
      [{ series: 2 }, /series/],
      [{ vNF: '1.00' }, /vNF/],
      [{ direction: 'EMITIDA' }, /EMITIDA/],
      [{ items: [existingFromFixture().items[0]] }, /itens: 1 no ERP ≠ 2/],
    ];
    for (const [over, re] of cases) {
      const plan = buildTargetFromNfe(parsedNfe(), ctx({ existingByChave: new Map([[CHAVE, [existingFromFixture(over)]]]) }));
      expect(plan.state).toBe('CONFLICT');
      expect(plan.reasons.join(' ')).toMatch(re);
    }
  });

  it('compareExisting: unitPrice comparado na precisão da coluna (10 casas no XML × 4 no ERP)', () => {
    const t = buildTargetFromNfe(parsedNfe(), ctx()).target!;
    expect(compareExisting(existingFromFixture(), t)).toEqual([]);
    expect(compareExisting(existingFromFixture({ items: [{ ...existingFromFixture().items[0], unitPrice: '4.1600' }, existingFromFixture().items[1]] }), t)).toEqual([expect.stringMatching(/item 1 unitPrice/)]);
    expect(compareExisting(existingFromFixture({ items: [{ ...existingFromFixture().items[0], nItem: 9 }, existingFromFixture().items[1]] }), t)).toEqual([expect.stringMatching(/item 1 sem correspondente/)]);
  });
});

describe('planBatch — lote de arquivos (pasta Qive)', () => {
  it('agrupa eventos por chave, deduplica arquivos idênticos, reporta órfãos e inválidos', () => {
    const files = [
      parseFileContent('Autorizadas/a.xml', nfeXml()),
      parseFileContent('Canceladas/a.xml', nfeXml()), // mesma nota nas duas pastas (idêntica)
      parseFileContent('Eventos/a_110111.xml', eventoXml({ tpEvento: '110111' })),
      parseFileContent('Eventos/orfao_110110.xml', eventoXml({ tpEvento: '110110', chave: '41260611111111000191550010000999991000099999' })),
      parseFileContent('lixo.xml', '<a><b></a>'),
      parseFileContent('cte.xml', '<cteProc/>'),
    ];
    const r = planBatch(files, ctx());
    expect(r.plans).toHaveLength(1);
    expect(r.plans[0].state).toBe('INSERT');
    expect(r.plans[0].target!.status).toBe('CANCELLED');
    expect(r.duplicateChaves).toEqual([{ chave: CHAVE, paths: ['Autorizadas/a.xml', 'Canceladas/a.xml'], divergent: false }]);
    expect(r.orphanEvents).toEqual([{ chNFe: '41260611111111000191550010000999991000099999', tpEvento: '110110', path: 'Eventos/orfao_110110.xml' }]);
    expect(r.invalidFiles).toHaveLength(1);
    expect(r.unknownFiles).toEqual([{ path: 'cte.xml', rootName: 'cteProc' }]);
  });

  it('mesma chave com conteúdo fiscal divergente ⇒ CONFLICT', () => {
    const r = planBatch([parseFileContent('1.xml', nfeXml()), parseFileContent('2.xml', nfeXml({ vNF: '9.99' }))], ctx());
    expect(r.plans[0].state).toBe('CONFLICT');
    expect(r.duplicateChaves[0].divergent).toBe(true);
  });

  it('evidência nominal é determinística (conjuntos ordenados) para o gate dry-run ⇄ commit', () => {
    const r = planBatch([parseFileContent('1.xml', nfeXml())], ctx({ existingByChave: new Map([[CHAVE, [existingFromFixture({ supplierId: null })]]]) }));
    expect(nominalEvidence(r.plans)).toEqual({ insert: [], update: ['doc-1|supplier=sup-1'] });
    const r2 = planBatch([parseFileContent('1.xml', nfeXml())], ctx());
    expect(nominalEvidence(r2.plans)).toEqual({ insert: [`co-crd|${CHAVE}`], update: [] });
  });
});

describe('mesmo caminho para o XML vindo da Focus (PR Focus-B)', () => {
  it('planFromXml(texto da Focus) ⇒ mesmo plano do arquivo local; applyPlan grava doc+itens+impostos em 1 create', async () => {
    const xmlDaFocus = nfeXml(); // a Focus devolve o mesmo nfeProc que o Qive exporta
    const plan = planFromXml(xmlDaFocus, ctx())!;
    expect(plan.state).toBe('INSERT');
    expect(plan).toEqual(planBatch([parseFileContent('local.xml', xmlDaFocus)], ctx()).plans[0]);

    const calls: any[] = [];
    const tx = {
      fiscalDocument: {
        create: async (args: any) => { calls.push(['create', args]); return { id: 'new-1' }; },
        update: async (args: any) => { calls.push(['update', args]); return { id: args.where.id }; },
      },
    };
    const r = await applyPlan(tx, plan, xmlDaFocus);
    expect(r).toEqual({ id: 'new-1', action: 'INSERT' });
    const data = calls[0][1].data;
    expect(data).toMatchObject({ companyId: 'co-crd', direction: 'RECEBIDA', chave: CHAVE, xml: xmlDaFocus, vNF: '5318.08', supplierId: 'sup-1' });
    expect(data.items.create).toHaveLength(2);
    expect(data.items.create[0].taxes.create[0]).toMatchObject({ cstIcms: '00', valorIcms: '606.07', difalValor: '353.54' });
    expect(data.items.create[1].taxes.create[0]).toMatchObject({ cstIcms: '102', cstIpi: '53' });
    expect(toCreateData(plan.target!, 'x').xml).toBe('x');
  });

  it('evento vindo da Focus não vira plano (chamador trata via planBatch/summarizeEvents)', () => {
    expect(planFromXml(eventoXml({ tpEvento: '110111' }), ctx())).toBeNull();
  });

  it('applyPlan recusa planos não executáveis (UNCHANGED/CONFLICT)', async () => {
    const plan = buildTargetFromNfe(parsedNfe(), ctx({ existingByChave: new Map([[CHAVE, [existingFromFixture()]]]) }));
    await expect(applyPlan({ fiscalDocument: { create: jest.fn(), update: jest.fn() } }, plan, '')).rejects.toThrow(/não é executável/);
  });
});
