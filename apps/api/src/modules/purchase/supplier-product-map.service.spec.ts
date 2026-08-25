import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupplierProductMapService } from './supplier-product-map.service';

/**
 * Banco fake mínimo: tabelas em memória com a unique (companyId, supplierId,
 * supplierProductCode), eventos append-only e $transaction passando o próprio
 * fake — suficiente para provar tenant isolation, auditoria e transições.
 */
function fakeDb() {
  const maps: any[] = [];
  const events: any[] = [];
  const suppliers = [
    { id: 'sup-A', companyId: 'c1', name: 'Fornecedor A', cnpj: '11111111000191' },
    { id: 'sup-B', companyId: 'c1', name: 'Fornecedor B', cnpj: '22222222000191' },
    { id: 'sup-Z', companyId: 'c2', name: 'Fornecedor Z (outra empresa)', cnpj: '11111111000191' }, // MESMO CNPJ, outro tenant
  ];
  const products = [
    { id: 'p-bom', companyId: 'c1', sku: 'COM-001', name: 'PARAFUSO SEXTAVADO M8 X 30 ZINCADO', type: 'COMPONENT', isActive: true },
    { id: 'p-semi-made', companyId: 'c1', sku: 'SEMI-001', name: 'CHASSI SOLDADO', type: 'SEMI_FINISHED', isActive: true },
    { id: 'p-semi-leaf', companyId: 'c1', sku: 'SEMI-002', name: 'EIXO MONTADO TERCEIRO', type: 'SEMI_FINISHED', isActive: true },
    { id: 'p-fg', companyId: 'c1', sku: 'FG-001', name: 'REBOQUE PRONTO', type: 'FINISHED_GOOD', isActive: true },
    { id: 'p-x', companyId: 'c1', sku: 'COM-002', name: 'CHAPA ACO 3MM', type: 'RAW_MATERIAL', isActive: true },
    { id: 'p-c2', companyId: 'c2', sku: 'COM-001', name: 'PRODUTO DA OUTRA EMPRESA', type: 'COMPONENT', isActive: true },
  ];
  let seq = 0;
  const items: any[] = [];
  const where = (row: any, w: any) => Object.entries(w).every(([k, v]) => (v && typeof v === 'object' && 'in' in (v as any)) ? (v as any).in.includes(row[k]) : row[k] === v);
  const db: any = {
    fiscalDocumentItem: {
      findMany: jest.fn(async ({ where: w }: any) => items
        .filter((i) => i.fiscalDocument.companyId === w.fiscalDocument.companyId && i.fiscalDocument.direction === 'RECEBIDA')
        .filter((i) => typeof w.fiscalDocument.supplierId === 'string' ? i.fiscalDocument.supplierId === w.fiscalDocument.supplierId : i.fiscalDocument.supplierId !== null)),
    },
    supplierProductMap: {
      findMany: jest.fn(async ({ where: w }: any) => maps.filter((m) => where(m, w))),
      findUnique: jest.fn(async ({ where: w }: any) => {
        const k = w.companyId_supplierId_supplierProductCode;
        return maps.find((m) => m.companyId === k.companyId && m.supplierId === k.supplierId && m.supplierProductCode === k.supplierProductCode) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => {
        if (maps.some((m) => m.companyId === data.companyId && m.supplierId === data.supplierId && m.supplierProductCode === data.supplierProductCode)) {
          throw Object.assign(new Error('Unique'), { code: 'P2002' });
        }
        const m = { id: `m${++seq}`, kind: null, productId: null, suggestedProductId: null, suggestedKind: null, suggestionSource: null, confirmedAt: null, confirmedById: null, reviewReason: null, notes: null, confirmedDescription: null, ...data };
        maps.push(m);
        return m;
      }),
      update: jest.fn(async ({ where: w, data }: any) => {
        const m = maps.find((x) => x.id === w.id);
        Object.assign(m, data);
        // espelho dos CHECKs do banco (defesa em profundidade)
        const pre = m.status === 'UNRESOLVED' || m.status === 'SUGGESTED';
        if (pre && (m.kind || m.productId || m.confirmedAt)) throw new Error('CHECK spm_pre_canonical_clean');
        if (!pre && (!m.kind || !m.confirmedAt)) throw new Error('CHECK spm_canonical_requires_confirmation');
        if (m.kind === 'PRODUCT' ? !m.productId : !!m.productId) throw new Error('CHECK spm_product_coherence');
        return m;
      }),
    },
    supplierProductMapEvent: {
      create: jest.fn(async ({ data }: any) => { const e = { id: `e${events.length + 1}`, createdAt: new Date(), ...data }; events.push(e); return e; }),
      findMany: jest.fn(async ({ where: w }: any) => events.filter((e) => e.mapId === w.mapId)),
    },
    supplier: {
      findFirst: jest.fn(async ({ where: w }: any) => suppliers.find((s) => s.id === w.id && s.companyId === w.companyId) ?? null),
      findMany: jest.fn(async ({ where: w }: any) => suppliers.filter((s) => s.companyId === w.companyId && w.id.in.includes(s.id))),
    },
    product: {
      findFirst: jest.fn(async ({ where: w }: any) => products.find((p) => p.id === w.id && p.companyId === w.companyId) ?? null),
      findMany: jest.fn(async ({ where: w }: any) => products.filter((p) => p.companyId === w.companyId && (!w.id || w.id.in.includes(p.id)))),
    },
    bomItem: { groupBy: jest.fn(async () => [{ componentId: 'p-bom', _count: { bomVersionId: 4 } }]) },
    bomVersion: { groupBy: jest.fn(async () => []) },
    pOItem: { groupBy: jest.fn(async () => []) },
    supplierPriceHistory: { groupBy: jest.fn(async () => []) },
    $transaction: jest.fn(async (fn: any) => fn(db)),
  };
  const addItem = (o: any) => items.push({
    productCode: 'X1', productName: 'PARAFUSO SEXT M8 X 30 ZINC', ncm: '73181500', unit: 'UN', quantity: 10, unitPrice: 2, totalPrice: 20,
    ...o, fiscalDocument: { id: `d${items.length + 1}`, companyId: 'c1', direction: 'RECEBIDA', status: 'AUTHORIZED', supplierId: 'sup-A', issueDate: new Date('2026-06-01'), ...(o.fiscalDocument ?? {}) },
  });
  return { db, maps, events, addItem };
}

describe('SupplierProductMapService (Fase 2, PR-2)', () => {
  let service: SupplierProductMapService;
  let f: ReturnType<typeof fakeDb>;

  beforeEach(async () => {
    f = fakeDb();
    const mod = await Test.createTestingModule({
      providers: [SupplierProductMapService, { provide: PrismaService, useValue: f.db }],
    }).compile();
    service = mod.get(SupplierProductMapService);
  });

  describe('listagem derivada (sem escrita)', () => {
    it('agrega pares por company, cruza com mapas, ignora cancelados e NÃO cria linhas de mapa', async () => {
      f.addItem({ totalPrice: 100 });
      f.addItem({ totalPrice: 50, fiscalDocument: { status: 'CANCELLED' } });
      f.addItem({ productCode: '0012', totalPrice: 30, fiscalDocument: { supplierId: 'sup-B' } });
      f.addItem({ productCode: '12', totalPrice: 5, fiscalDocument: { supplierId: 'sup-B' } });
      f.addItem({ productCode: 'X1', totalPrice: 999, fiscalDocument: { companyId: 'c2', supplierId: 'sup-Z' } }); // outro tenant
      const r = await service.listPairs('c1');
      expect(r.total).toBe(3);
      expect(r.items.map((v) => [v.supplierId, v.supplierProductCode, v.totalValue])).toEqual([
        ['sup-A', 'X1', 100], ['sup-B', '0012', 30], ['sup-B', '12', 5],
      ]);
      expect(r.items[0].supplierName).toBe('Fornecedor A');
      expect(f.maps).toHaveLength(0);
      expect(f.db.supplierProductMap.create).not.toHaveBeenCalled();
    });

    it('tenant isolation: a company c2 vê só os pares dela (mesmo CNPJ de fornecedor não mistura)', async () => {
      f.addItem({ totalPrice: 100 });
      f.addItem({ productCode: 'X1', totalPrice: 999, fiscalDocument: { companyId: 'c2', supplierId: 'sup-Z' } });
      const c2 = await service.listPairs('c2');
      expect(c2.items.map((v) => [v.supplierId, v.totalValue])).toEqual([['sup-Z', 999]]);
      expect(c2.items[0].supplierName).toBe('Fornecedor Z (outra empresa)');
    });

    it('filtros: status, pendingOnly, bomOnly, q, paginação', async () => {
      f.addItem({ totalPrice: 100 });
      f.addItem({ productCode: 'K9', productName: 'CHAPA ACO 3MM', totalPrice: 20, fiscalDocument: { supplierId: 'sup-B' } });
      await service.confirmProduct('c1', { supplierId: 'sup-A', supplierProductCode: 'X1' }, 'p-bom', 'u1');
      expect((await service.listPairs('c1', { status: 'CONFIRMED' })).items.map((v) => v.supplierProductCode)).toEqual(['X1']);
      expect((await service.listPairs('c1', { pendingOnly: true })).items.map((v) => v.supplierProductCode)).toEqual(['K9']);
      expect((await service.listPairs('c1', { bomOnly: true })).items.map((v) => v.supplierProductCode)).toEqual(['X1']);
      expect((await service.listPairs('c1', { q: 'chapa' })).items.map((v) => v.supplierProductCode)).toEqual(['K9']);
      const p = await service.listPairs('c1', { page: 2, pageSize: 1 });
      expect(p).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect(p.items).toHaveLength(1);
    });

    it('par confirmado aparece com canônico, BOM via CONFIRMED e tier 2; resumo e bom-coverage refletem', async () => {
      f.addItem({ totalPrice: 100 });
      f.addItem({ productCode: 'K9', totalPrice: 300, fiscalDocument: { supplierId: 'sup-B' } });
      await service.confirmProduct('c1', { supplierId: 'sup-A', supplierProductCode: 'X1' }, 'p-bom', 'u1');
      const r = await service.listPairs('c1');
      const x1 = r.items.find((v) => v.supplierProductCode === 'X1')!;
      expect(x1).toMatchObject({ status: 'CONFIRMED', priorityTier: 2, needsDecision: false });
      expect(x1.canonical).toMatchObject({ kind: 'PRODUCT', productId: 'p-bom', productSku: 'COM-001' });
      expect(x1.bomRelevance).toEqual({ productId: 'p-bom', activeBomCount: 4, via: 'CONFIRMED' });
      expect(await service.summary('c1')).toMatchObject({ pairs: 2, totalValue: 400, resolvedValue: 100, resolvedValuePct: 25, pairsToReachTarget: 1 });
      const cov = await service.bomCoverage('c1');
      expect(cov).toEqual([expect.objectContaining({ productId: 'p-bom', covered: true, confirmedPairs: 1, activeBomCount: 4 })]);
    });

    it('bom-coverage: SEMI_FINISHED entra só como folha (sem BOM própria) ou com evidência de compra (PO/preço/mapa); fabricado e FINISHED_GOOD ficam fora', async () => {
      f.db.bomItem.groupBy.mockResolvedValue([
        { componentId: 'p-bom', _count: { bomVersionId: 4 } },
        { componentId: 'p-semi-made', _count: { bomVersionId: 10 } },
        { componentId: 'p-semi-leaf', _count: { bomVersionId: 2 } },
        { componentId: 'p-fg', _count: { bomVersionId: 1 } },
      ]);
      f.db.bomVersion.groupBy.mockResolvedValue([{ productId: 'p-semi-made' }, { productId: 'p-fg' }]); // têm BOM própria ativa
      let cov = await service.bomCoverage('c1');
      expect(cov.map((c) => [c.sku, c.purchasedReason])).toEqual([['COM-001', 'BY_TYPE'], ['SEMI-002', 'LEAF_SEMI_FINISHED']]);
      // evidência de compra (POItem) faz o SEMI_FINISHED fabricado entrar; FINISHED_GOOD só com evidência
      f.db.pOItem.groupBy.mockResolvedValue([{ productId: 'p-semi-made' }]);
      cov = await service.bomCoverage('c1');
      expect(cov.map((c) => [c.sku, c.purchasedReason])).toEqual([['SEMI-001', 'PURCHASE_EVIDENCE'], ['COM-001', 'BY_TYPE'], ['SEMI-002', 'LEAF_SEMI_FINISHED']]);
      expect(f.db.pOItem.groupBy).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ productId: { in: expect.any(Array) } }) }));
    });

    it('CRD-like: company sem Products/BOM pode ficar parcialmente UNRESOLVED indefinidamente — lista, resumo e cobertura continuam consistentes', async () => {
      f.addItem({ productCode: 'X1', totalPrice: 999, fiscalDocument: { companyId: 'c2', supplierId: 'sup-Z' } });
      f.addItem({ productCode: 'FRETE', productName: 'FRETE', totalPrice: 50, fiscalDocument: { companyId: 'c2', supplierId: 'sup-Z' } });
      f.db.bomItem.groupBy.mockResolvedValue([]);
      await service.classify('c2', { supplierId: 'sup-Z', supplierProductCode: 'FRETE' }, 'FREIGHT_OTHER', 'u9');
      const list = await service.listPairs('c2');
      expect(list.items.map((v) => [v.supplierProductCode, v.status, v.priorityTier])).toEqual([['X1', 'UNRESOLVED', 1], ['FRETE', 'CONFIRMED', 2]]);
      expect(await service.summary('c2')).toMatchObject({ pairs: 2, byStatus: { UNRESOLVED: 1, CONFIRMED: 1, SUGGESTED: 0, REVIEW: 0 }, pendingBomRelevant: 0 });
      expect(await service.bomCoverage('c2')).toEqual([]);
      expect(await service.previewDescriptionSuggestions('c2')).toEqual([]); // sem catálogo: nada sugerido, nada classificado automaticamente
    });

    it('prioridade: pendente com SUGESTÃO para componente de BOM ativa vem antes do pendente de maior valor', async () => {
      f.addItem({ totalPrice: 100 }); // X1 → sugerido p-bom
      f.addItem({ productCode: 'CAPEX', productName: 'MAQUINA LASER', totalPrice: 1_000_000, fiscalDocument: { supplierId: 'sup-B' } });
      await service.suggest('c1', { supplierId: 'sup-A', supplierProductCode: 'X1' }, { productId: 'p-bom', source: 'DESCRIPTION', rationale: 'jaccard=0.8' });
      const r = await service.listPairs('c1');
      expect(r.items.map((v) => v.supplierProductCode)).toEqual(['X1', 'CAPEX']);
      expect(r.items[0]).toMatchObject({ status: 'SUGGESTED', priorityTier: 0, canonical: null });
      expect(r.items[0].bomRelevance).toEqual({ productId: 'p-bom', activeBomCount: 4, via: 'SUGGESTED' });
      // bom-coverage: sugestão NÃO cobre
      expect((await service.bomCoverage('c1'))[0]).toMatchObject({ covered: false, suggestedPairs: 1, confirmedPairs: 0 });
    });
  });

  describe('resolução humana (transacional, auditada, sem apagar história)', () => {
    beforeEach(() => { f.addItem({ totalPrice: 100 }); });
    const ref = { supplierId: 'sup-A', supplierProductCode: 'X1' };

    it('confirmar Product: cria o mapa na primeira decisão (com lastSeen), CONFIRMED/PRODUCT/productId, evento CONFIRMED com ator', async () => {
      const m = await service.confirmProduct('c1', ref, 'p-bom', 'u1', 'é o parafuso da BOM');
      expect(m).toMatchObject({ status: 'CONFIRMED', kind: 'PRODUCT', productId: 'p-bom', confirmedById: 'u1', lastSeenDescription: 'PARAFUSO SEXT M8 X 30 ZINC', confirmedDescription: 'PARAFUSO SEXT M8 X 30 ZINC' });
      expect(m.confirmedAt).toBeInstanceOf(Date);
      expect(f.events).toHaveLength(1);
      expect(f.events[0]).toMatchObject({ action: 'CONFIRMED', fromStatus: 'UNRESOLVED', toStatus: 'CONFIRMED', fromProductId: null, toProductId: 'p-bom', actorId: 'u1', reason: 'é o parafuso da BOM' });
      expect(f.db.$transaction).toHaveBeenCalled();
    });

    it('trocar o Product: RECLASSIFIED com from/to; vale para o histórico e para as próximas compras (mesma linha canônica)', async () => {
      await service.confirmProduct('c1', ref, 'p-x', 'u1');
      const m = await service.confirmProduct('c1', ref, 'p-bom', 'u2', 'estava errado');
      expect(m).toMatchObject({ status: 'CONFIRMED', productId: 'p-bom', confirmedById: 'u2' });
      expect(f.maps).toHaveLength(1); // mesma identidade canônica
      expect(f.events.map((e) => [e.action, e.fromProductId, e.toProductId, e.actorId])).toEqual([
        ['CONFIRMED', null, 'p-x', 'u1'], ['RECLASSIFIED', 'p-x', 'p-bom', 'u2'],
      ]);
    });

    it('classificar como não-produto (CONSUMABLE/ASSET/FREIGHT_OTHER): CONFIRMED sem productId; trocar classificação também audita', async () => {
      const m = await service.classify('c1', ref, 'CONSUMABLE', 'u1');
      expect(m).toMatchObject({ status: 'CONFIRMED', kind: 'CONSUMABLE', productId: null });
      const m2 = await service.classify('c1', ref, 'ASSET', 'u1', 'na verdade é máquina');
      expect(m2).toMatchObject({ kind: 'ASSET' });
      expect(f.events.map((e) => [e.action, e.fromKind, e.toKind])).toEqual([['CONFIRMED', null, 'CONSUMABLE'], ['RECLASSIFIED', 'CONSUMABLE', 'ASSET']]);
      // de não-produto para Product: canônico troca, productId entra
      const m3 = await service.confirmProduct('c1', ref, 'p-bom', 'u1');
      expect(m3).toMatchObject({ kind: 'PRODUCT', productId: 'p-bom' });
      expect(f.events.at(-1)).toMatchObject({ action: 'RECLASSIFIED', fromKind: 'ASSET', toKind: 'PRODUCT' });
    });

    it('sugestão NUNCA vira confirmação: fica SUGGESTED, canônico vazio, mesmo com ator humano; confirmar depois é ato separado', async () => {
      const s = await service.suggest('c1', ref, { productId: 'p-bom', source: 'MANUAL', rationale: 'acho que é este' }, 'u1');
      expect(s).toMatchObject({ status: 'SUGGESTED', kind: null, productId: null, confirmedAt: null, suggestedProductId: 'p-bom', suggestedKind: 'PRODUCT', suggestionSource: 'MANUAL' });
      expect(f.events[0]).toMatchObject({ action: 'SUGGESTED', toStatus: 'SUGGESTED', reason: 'MANUAL acho que é este', actorId: 'u1' });
      const auto = await service.suggest('c1', { supplierId: 'sup-A', supplierProductCode: 'X1' }, { productId: 'p-x', source: 'SEED_PRODUCAO_V2' }, null);
      expect(auto).toMatchObject({ status: 'SUGGESTED', productId: null, suggestedProductId: 'p-x' });
      const c = await service.confirmProduct('c1', ref, 'p-x', 'u1');
      expect(c).toMatchObject({ status: 'CONFIRMED', productId: 'p-x' });
      expect(f.events.map((e) => e.action)).toEqual(['SUGGESTED', 'SUGGESTED', 'CONFIRMED']);
    });

    it('descartar sugestão volta a UNRESOLVED (REVERTED na história); sugerir em CONFIRMED é recusado', async () => {
      await service.suggest('c1', ref, { productId: 'p-bom', source: 'DESCRIPTION' }, null);
      const m = await service.dismissSuggestion('c1', ref, 'u1');
      expect(m).toMatchObject({ status: 'UNRESOLVED', suggestedProductId: null, suggestionSource: null });
      expect(f.events.at(-1)).toMatchObject({ action: 'REVERTED', fromStatus: 'SUGGESTED', toStatus: 'UNRESOLVED' });
      await service.confirmProduct('c1', ref, 'p-bom', 'u1');
      await expect(service.suggest('c1', ref, { productId: 'p-x', source: 'DESCRIPTION' }, null)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('review: CONFIRMED → REVIEW mantém o vínculo anterior; reconfirmar fecha; razão obrigatória', async () => {
      await service.confirmProduct('c1', ref, 'p-x', 'u1');
      const r = await service.flagReview('c1', ref, 'u2', 'descrição mudou muito');
      expect(r).toMatchObject({ status: 'REVIEW', productId: 'p-x', kind: 'PRODUCT', reviewReason: 'descrição mudou muito' });
      await expect(service.flagReview('c1', ref, 'u2', '')).rejects.toBeInstanceOf(BadRequestException);
      const c = await service.confirmProduct('c1', ref, 'p-bom', 'u2');
      expect(c).toMatchObject({ status: 'CONFIRMED', productId: 'p-bom', reviewReason: null });
      expect(f.events.map((e) => e.action)).toEqual(['CONFIRMED', 'REVIEW_FLAGGED', 'RECLASSIFIED']);
    });

    it('tenant isolation na escrita: fornecedor ou Product de outra empresa são recusados; nada gravado', async () => {
      await expect(service.confirmProduct('c1', { supplierId: 'sup-Z', supplierProductCode: 'X1' }, 'p-bom', 'u1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.confirmProduct('c1', ref, 'p-c2', 'u1')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.suggest('c1', ref, { productId: 'p-c2', source: 'DESCRIPTION' }, null)).rejects.toBeInstanceOf(BadRequestException);
      expect(f.events).toHaveLength(0);
      expect(f.maps.every((m) => m.status === 'UNRESOLVED' && m.productId === null)).toBe(true);
    });

    it('mesmo fornecedor+cProd em companies diferentes são mapas independentes', async () => {
      f.addItem({ productCode: 'X1', totalPrice: 999, fiscalDocument: { companyId: 'c2', supplierId: 'sup-Z' } });
      await service.confirmProduct('c1', ref, 'p-bom', 'u1');
      await service.classify('c2', { supplierId: 'sup-Z', supplierProductCode: 'X1' }, 'ASSET', 'u9');
      expect(f.maps.map((m) => [m.companyId, m.supplierId, m.kind])).toEqual([['c1', 'sup-A', 'PRODUCT'], ['c2', 'sup-Z', 'ASSET']]);
      const c1 = await service.getPair('c1', ref);
      expect(c1.canonical?.productId).toBe('p-bom');
      expect(c1.events).toHaveLength(1);
    });

    it('ações humanas exigem ator; cProd com zeros à esquerda é preservado na identidade', async () => {
      await expect(service.confirmProduct('c1', ref, 'p-bom', '')).rejects.toBeInstanceOf(BadRequestException);
      f.addItem({ productCode: '0012', totalPrice: 1, fiscalDocument: { supplierId: 'sup-B' } });
      const m = await service.classify('c1', { supplierId: 'sup-B', supplierProductCode: ' 0012 ' }, 'FREIGHT_OTHER', 'u1');
      expect(m.supplierProductCode).toBe('0012');
      await expect(service.getPair('c1', { supplierId: 'sup-B', supplierProductCode: '12' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('sugestão por descrição e divergência', () => {
    it('prévia não escreve; apply grava SUGGESTED (source DESCRIPTION) e nunca CONFIRMED', async () => {
      f.addItem({ totalPrice: 100 }); // PARAFUSO SEXT M8 X 30 ZINC → p-bom
      f.addItem({ productCode: 'K9', productName: 'OLEO LUBRIFICANTE 20L', totalPrice: 20, fiscalDocument: { supplierId: 'sup-B' } });
      const preview = await service.previewDescriptionSuggestions('c1');
      expect(preview).toHaveLength(1);
      expect(preview[0]).toMatchObject({ supplierProductCode: 'X1', bomRelevant: true });
      expect(preview[0].candidate).toMatchObject({ productId: 'p-bom' });
      expect(f.maps).toHaveLength(0);
      const applied = await service.applyDescriptionSuggestions('c1', null);
      expect(applied).toEqual({ suggested: 1, failed: 0 });
      expect(f.maps[0]).toMatchObject({ status: 'SUGGESTED', suggestedProductId: 'p-bom', suggestionSource: 'DESCRIPTION', productId: null, kind: null });
      expect(f.events[0].reason).toContain('DESCRIPTION jaccard=');
      // reexecução: par já tem sugestão → nada novo
      expect(await service.applyDescriptionSuggestions('c1', null)).toEqual({ suggested: 0, failed: 0 });
    });

    it('detectDivergences: descrição nova sem nada em comum com a confirmada → candidato a REVIEW (não muda nada sozinho)', async () => {
      f.addItem({ totalPrice: 100, productName: 'PARAFUSO SEXT M8', fiscalDocument: { issueDate: new Date('2026-01-01') } });
      await service.confirmProduct('c1', { supplierId: 'sup-A', supplierProductCode: 'X1' }, 'p-bom', 'u1');
      f.addItem({ totalPrice: 5, productName: 'FRETE TRANSPORTE RODOVIARIO', fiscalDocument: { issueDate: new Date('2026-08-01') } });
      const d = await service.detectDivergences('c1');
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ supplierProductCode: 'X1', confirmed: 'PARAFUSO SEXT M8', incoming: 'FRETE TRANSPORTE RODOVIARIO' });
      expect(f.maps[0].status).toBe('CONFIRMED');
    });
  });
});
