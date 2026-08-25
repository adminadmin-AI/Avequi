import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SpmKind,
  SpmStatus,
  SuggestionSource,
  canTransition,
  descriptionDiverges,
  maxStatusForSource,
  validateState,
  validateTenantConsistency,
} from './supplier-product-map.rules';
import {
  BomComponentCoverage,
  CoverageSummary,
  DescriptionCandidate,
  ExistingMap,
  FiscalItemRow,
  PURCHASED_COMPONENT_TYPES,
  PairMetrics,
  PairView,
  ProductRef,
  aggregatePairs,
  bomCoverage,
  buildPairViews,
  comparePriority,
  normalizeSupplierProductCode,
  pairKey,
  suggestByDescription,
  summarize,
} from './supplier-product-map.aggregate';

/**
 * SupplierProductMap — serviço de conciliação (Fase 2, PR-2).
 *
 *   FiscalDocument RECEBIDA → FiscalDocumentItem.cProd → SupplierProductMap → Product
 *
 * Desenho:
 *  - a LISTAGEM é uma visão derivada: pares vêm dos itens fiscais autorizados
 *    (agregados em memória pelo núcleo puro) e são cruzados com as linhas de
 *    mapa existentes. Nenhuma linha é criada só para listar — o mapa nasce na
 *    primeira decisão/sugestão sobre o par (`ensureMap`), sem backfill;
 *  - o mapa é o de-para CANÔNICO. Confirmar um par NÃO reescreve
 *    FiscalDocumentItem.productId histórico: o vínculo é obtido por junção
 *    (item.cProd + documento.supplierId → mapa). Materializar productId no
 *    item, se um dia o motor de custo precisar, é uma projeção reexecutável
 *    em passo próprio — fora deste PR;
 *  - toda mudança humana passa por transação: UPDATE do mapa + INSERT de
 *    SupplierProductMapEvent (antes/depois, ator, razão). Nada é apagado;
 *  - sugestão (suggested*, SUGGESTED) nunca vira CONFIRMED sozinha
 *    (`maxStatusForSource`); só ação humana com actorId confirma;
 *  - isolamento por tenant: supplier/product/suggestedProduct são carregados
 *    com o companyId do mapa (`validateTenantConsistency`).
 */

export interface ListPairsQuery {
  status?: SpmStatus;
  supplierId?: string;
  /** busca em cProd, descrição, fornecedor */
  q?: string;
  /** só pares ligados a BOM ativa (por canônico ou sugestão) */
  bomOnly?: boolean;
  /** só pares que ainda precisam de decisão */
  pendingOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface PairRef {
  supplierId: string;
  supplierProductCode: string;
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

@Injectable()
export class SupplierProductMapService {
  private readonly logger = new Logger(SupplierProductMapService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Leitura ───────────────────────────────────────────────────────────────

  private async loadItemRows(companyId: string, filter: { supplierId?: string } = {}): Promise<FiscalItemRow[]> {
    const items = await this.prisma.fiscalDocumentItem.findMany({
      where: {
        fiscalDocument: {
          companyId,
          direction: 'RECEBIDA',
          supplierId: filter.supplierId ? filter.supplierId : { not: null },
        },
      },
      select: {
        productCode: true, productName: true, ncm: true, unit: true, quantity: true, unitPrice: true, totalPrice: true,
        fiscalDocument: { select: { id: true, status: true, supplierId: true, issueDate: true } },
      },
    });
    return items.map((i) => ({
      documentId: i.fiscalDocument.id,
      documentStatus: i.fiscalDocument.status,
      supplierId: i.fiscalDocument.supplierId,
      issueDate: i.fiscalDocument.issueDate,
      productCode: i.productCode,
      productName: i.productName,
      ncm: i.ncm,
      unit: i.unit,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unitPrice),
      totalPrice: Number(i.totalPrice),
    }));
  }

  private async loadMaps(companyId: string, filter: { supplierId?: string } = {}): Promise<ExistingMap[]> {
    const rows = await this.prisma.supplierProductMap.findMany({
      where: { companyId, ...(filter.supplierId ? { supplierId: filter.supplierId } : {}) },
    });
    return rows.map((m) => ({
      id: m.id, supplierId: m.supplierId, supplierProductCode: m.supplierProductCode,
      status: m.status as SpmStatus, kind: (m.kind as SpmKind | null) ?? null, productId: m.productId,
      suggestedProductId: m.suggestedProductId, suggestedKind: (m.suggestedKind as SpmKind | null) ?? null,
      suggestionSource: m.suggestionSource, confirmedAt: m.confirmedAt, confirmedById: m.confirmedById,
      reviewReason: m.reviewReason, notes: m.notes, lastSeenDescription: m.lastSeenDescription,
    }));
  }

  /** componentId → nº de BOMs ATIVAS (só desta company) */
  private async loadActiveBomCounts(companyId: string): Promise<Map<string, number>> {
    const grouped = await this.prisma.bomItem.groupBy({
      by: ['componentId'],
      where: { bomVersion: { companyId, isActive: true } },
      _count: { bomVersionId: true },
    });
    return new Map(grouped.map((g) => [g.componentId, g._count.bomVersionId]));
  }

  private async loadProducts(companyId: string, ids?: string[]): Promise<Map<string, ProductRef>> {
    const rows = await this.prisma.product.findMany({
      where: { companyId, ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, sku: true, name: true, type: true, isActive: true },
    });
    return new Map(rows.map((p) => [p.id, { id: p.id, sku: p.sku, name: p.name, type: p.type, isActive: p.isActive }]));
  }

  private async loadSuppliers(companyId: string, ids: string[]): Promise<Map<string, { name: string; cnpj: string | null }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.supplier.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true, cnpj: true } });
    return new Map(rows.map((s) => [s.id, { name: s.name, cnpj: s.cnpj }]));
  }

  /** Visão completa dos pares da company (derivada; sem escrita). */
  async buildViews(companyId: string, filter: { supplierId?: string } = {}): Promise<PairView[]> {
    const [rows, maps, bomCounts] = await Promise.all([
      this.loadItemRows(companyId, filter),
      this.loadMaps(companyId, filter),
      this.loadActiveBomCounts(companyId),
    ]);
    const metrics = aggregatePairs(rows);
    const productIds = new Set<string>();
    for (const m of maps) { if (m.productId) productIds.add(m.productId); if (m.suggestedProductId) productIds.add(m.suggestedProductId); }
    const supplierIds = new Set<string>([...metrics.map((m) => m.supplierId), ...maps.map((m) => m.supplierId)]);
    const [products, suppliers] = await Promise.all([
      productIds.size ? this.loadProducts(companyId, [...productIds]) : Promise.resolve(new Map<string, ProductRef>()),
      this.loadSuppliers(companyId, [...supplierIds]),
    ]);
    return buildPairViews({ metrics, maps, suppliers, products, activeBomCountByProduct: bomCounts });
  }

  async listPairs(companyId: string, q: ListPairsQuery = {}): Promise<{ total: number; page: number; pageSize: number; items: PairView[] }> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    let views = await this.buildViews(companyId, { supplierId: q.supplierId });
    if (q.status) views = views.filter((v) => v.status === q.status);
    if (q.bomOnly) views = views.filter((v) => v.bomRelevance !== null);
    if (q.pendingOnly) views = views.filter((v) => v.needsDecision);
    if (q.q) {
      const needle = q.q.trim().toLowerCase();
      views = views.filter((v) =>
        v.supplierProductCode.toLowerCase().includes(needle) ||
        (v.lastDescription ?? '').toLowerCase().includes(needle) ||
        (v.supplierName ?? '').toLowerCase().includes(needle) ||
        (v.supplierCnpj ?? '').includes(needle.replace(/\D/g, '') || ' '),
      );
    }
    views.sort(comparePriority);
    const start = (page - 1) * pageSize;
    return { total: views.length, page, pageSize, items: views.slice(start, start + pageSize) };
  }

  async summary(companyId: string, targetPct = 0.8): Promise<CoverageSummary> {
    return summarize(await this.buildViews(companyId), targetPct);
  }

  /** Componentes COMPRADOS das BOMs ativas × cobertura de de-para confirmado. */
  async bomCoverage(companyId: string): Promise<BomComponentCoverage[]> {
    const [views, bomCounts] = await Promise.all([this.buildViews(companyId), this.loadActiveBomCounts(companyId)]);
    const ids = [...bomCounts.keys()];
    if (ids.length === 0) return [];
    const products = await this.loadProducts(companyId, ids);
    const components = [...products.values()]
      .filter((p) => (PURCHASED_COMPONENT_TYPES as readonly string[]).includes(p.type))
      .map((p) => ({ ...p, activeBomCount: bomCounts.get(p.id) ?? 0 }));
    return bomCoverage(components, views);
  }

  async getPair(companyId: string, ref: PairRef) {
    const code = normalizeSupplierProductCode(ref.supplierProductCode);
    if (!code) throw new BadRequestException('supplierProductCode vazio');
    const views = await this.buildViews(companyId, { supplierId: ref.supplierId });
    const view = views.find((v) => v.supplierId === ref.supplierId && v.supplierProductCode === code);
    if (!view) throw new NotFoundException(`Par (${ref.supplierId}, ${code}) não encontrado nesta empresa`);
    const events = view.mapId
      ? await this.prisma.supplierProductMapEvent.findMany({ where: { mapId: view.mapId }, orderBy: { createdAt: 'asc' } })
      : [];
    return { ...view, events };
  }

  // ─── Escrita (decisão humana) ──────────────────────────────────────────────

  /** Garante a linha de mapa do par (UNRESOLVED, com evidência lastSeen). Nunca cria fora do tenant. */
  private async ensureMap(tx: Tx, companyId: string, ref: PairRef): Promise<ExistingMap & { confirmedDescription: string | null }> {
    const code = normalizeSupplierProductCode(ref.supplierProductCode);
    if (!code) throw new BadRequestException('supplierProductCode vazio');
    const supplier = await tx.supplier.findFirst({ where: { id: ref.supplierId, companyId }, select: { id: true } });
    if (!supplier) throw new NotFoundException('Fornecedor não encontrado nesta empresa');
    let m = await tx.supplierProductMap.findUnique({
      where: { companyId_supplierId_supplierProductCode: { companyId, supplierId: ref.supplierId, supplierProductCode: code } },
    });
    if (!m) {
      const rows = await this.loadItemRows(companyId, { supplierId: ref.supplierId });
      const met: PairMetrics | undefined = aggregatePairs(rows).find((x) => x.supplierProductCode === code);
      m = await tx.supplierProductMap.create({
        data: {
          companyId, supplierId: ref.supplierId, supplierProductCode: code, status: 'UNRESOLVED',
          lastSeenDescription: met?.lastDescription ?? null, lastSeenNcm: met?.lastNcm ?? null, lastSeenUnit: met?.lastUnit ?? null,
          lastSeenUnitPrice: met?.lastUnitPrice ?? null, lastSeenAt: met?.lastPurchaseAt ?? null,
        },
      });
    }
    return {
      id: m.id, supplierId: m.supplierId, supplierProductCode: m.supplierProductCode, status: m.status as SpmStatus,
      kind: (m.kind as SpmKind | null) ?? null, productId: m.productId, suggestedProductId: m.suggestedProductId,
      suggestedKind: (m.suggestedKind as SpmKind | null) ?? null, suggestionSource: m.suggestionSource, confirmedAt: m.confirmedAt,
      confirmedById: m.confirmedById, reviewReason: m.reviewReason, notes: m.notes, lastSeenDescription: m.lastSeenDescription,
      confirmedDescription: m.confirmedDescription,
    };
  }

  private async assertProductInTenant(tx: Tx, companyId: string, productId: string, label: 'product' | 'suggestedProduct'): Promise<void> {
    const p = await tx.product.findFirst({ where: { id: productId, companyId }, select: { id: true, companyId: true } });
    const errors = validateTenantConsistency({
      mapCompanyId: companyId,
      supplierCompanyId: companyId, // supplier já validado em ensureMap
      productCompanyId: label === 'product' ? (p?.companyId ?? null) : undefined,
      suggestedProductCompanyId: label === 'suggestedProduct' ? (p?.companyId ?? null) : undefined,
    });
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }

  private assertTransition(from: SpmStatus, to: SpmStatus): void {
    if (!canTransition(from, to)) throw new BadRequestException(`Transição ${from} → ${to} não permitida`);
  }

  private assertState(s: { status: SpmStatus; kind: SpmKind | null; productId: string | null; confirmedAt: Date | null }): void {
    const errors = validateState(s);
    if (errors.length) throw new BadRequestException(errors.join('; '));
  }

  /**
   * "Fornecedor X + código Y corresponde ao Product Z" — decisão humana.
   * Vale para o histórico e para as próximas compras (de-para canônico).
   * Se já estava CONFIRMED com outro Product, é uma TROCA (RECLASSIFIED),
   * mantendo a história no evento.
   */
  async confirmProduct(companyId: string, ref: PairRef, productId: string, actorId: string, reason?: string) {
    if (!actorId) throw new BadRequestException('Confirmação exige um usuário (ator)');
    return this.prisma.$transaction(async (tx) => {
      const m = await this.ensureMap(tx, companyId, ref);
      await this.assertProductInTenant(tx, companyId, productId, 'product');
      this.assertTransition(m.status, 'CONFIRMED');
      const now = new Date();
      const next = { status: 'CONFIRMED' as SpmStatus, kind: 'PRODUCT' as SpmKind, productId, confirmedAt: now };
      this.assertState(next);
      const isChange = m.status === 'CONFIRMED' || m.status === 'REVIEW';
      const updated = await tx.supplierProductMap.update({
        where: { id: m.id },
        data: {
          status: 'CONFIRMED', kind: 'PRODUCT', productId, confirmedAt: now, confirmedById: actorId,
          confirmedDescription: m.lastSeenDescription, reviewReason: null,
        },
      });
      await tx.supplierProductMapEvent.create({
        data: {
          mapId: m.id, action: isChange ? 'RECLASSIFIED' : 'CONFIRMED',
          fromStatus: m.status, toStatus: 'CONFIRMED', fromKind: m.kind, toKind: 'PRODUCT',
          fromProductId: m.productId, toProductId: productId, reason: reason ?? null, actorId,
        },
      });
      this.logger.log(`SPM ${companyId} (${ref.supplierId}, ${m.supplierProductCode}) → PRODUCT ${productId} por ${actorId}`);
      return updated;
    });
  }

  /** Classificar como NÃO-produto (CONSUMABLE/ASSET/FREIGHT_OTHER) — conciliado sem Product artificial. */
  async classify(companyId: string, ref: PairRef, kind: Exclude<SpmKind, 'PRODUCT'>, actorId: string, reason?: string) {
    if (!actorId) throw new BadRequestException('Classificação exige um usuário (ator)');
    if (kind === ('PRODUCT' as SpmKind)) throw new BadRequestException('Para PRODUCT use confirmProduct com o productId');
    return this.prisma.$transaction(async (tx) => {
      const m = await this.ensureMap(tx, companyId, ref);
      this.assertTransition(m.status, 'CONFIRMED');
      const now = new Date();
      this.assertState({ status: 'CONFIRMED', kind, productId: null, confirmedAt: now });
      const isChange = m.status === 'CONFIRMED' || m.status === 'REVIEW';
      const updated = await tx.supplierProductMap.update({
        where: { id: m.id },
        data: { status: 'CONFIRMED', kind, productId: null, confirmedAt: now, confirmedById: actorId, confirmedDescription: m.lastSeenDescription, reviewReason: null },
      });
      await tx.supplierProductMapEvent.create({
        data: {
          mapId: m.id, action: isChange ? 'RECLASSIFIED' : 'CONFIRMED',
          fromStatus: m.status, toStatus: 'CONFIRMED', fromKind: m.kind, toKind: kind,
          fromProductId: m.productId, toProductId: null, reason: reason ?? null, actorId,
        },
      });
      return updated;
    });
  }

  /**
   * Registrar uma SUGESTÃO (Product e/ou kind). Nunca confirma: qualquer
   * origem — inclusive humana — deixa o par em SUGGESTED; a verdade canônica
   * (kind/productId) continua vazia até confirmProduct/classify.
   */
  async suggest(companyId: string, ref: PairRef, s: { productId?: string | null; kind?: SpmKind | null; source: SuggestionSource; rationale?: string }, actorId?: string | null) {
    if (!s.productId && !s.kind) throw new BadRequestException('Sugestão precisa de productId e/ou kind');
    if (s.productId && s.kind && s.kind !== 'PRODUCT') throw new BadRequestException('Sugestão com productId só pode ter kind PRODUCT');
    return this.prisma.$transaction(async (tx) => {
      const m = await this.ensureMap(tx, companyId, ref);
      if (s.productId) await this.assertProductInTenant(tx, companyId, s.productId, 'suggestedProduct');
      // teto por origem: nunca passa de SUGGESTED aqui, mesmo com ator humano
      const ceiling = maxStatusForSource(s.source, !!actorId);
      const to: SpmStatus = ceiling === 'CONFIRMED' ? 'SUGGESTED' : ceiling;
      this.assertTransition(m.status, to);
      if (m.status === 'CONFIRMED') throw new BadRequestException('Par já CONFIRMED: use review para reabrir antes de sugerir');
      const updated = await tx.supplierProductMap.update({
        where: { id: m.id },
        data: { status: to, suggestedProductId: s.productId ?? null, suggestedKind: s.productId ? 'PRODUCT' : (s.kind ?? null), suggestionSource: s.source },
      });
      await tx.supplierProductMapEvent.create({
        data: {
          mapId: m.id, action: 'SUGGESTED', fromStatus: m.status, toStatus: to,
          fromKind: m.kind, toKind: m.kind, fromProductId: m.productId, toProductId: m.productId,
          reason: `${s.source}${s.rationale ? ' ' + s.rationale : ''}`, actorId: actorId ?? null,
        },
      });
      return updated;
    });
  }

  /** Descartar a sugestão: volta a UNRESOLVED (a sugestão fica na história, não no mapa). */
  async dismissSuggestion(companyId: string, ref: PairRef, actorId: string, reason?: string) {
    if (!actorId) throw new BadRequestException('Descartar sugestão exige um usuário (ator)');
    return this.prisma.$transaction(async (tx) => {
      const m = await this.ensureMap(tx, companyId, ref);
      this.assertTransition(m.status, 'UNRESOLVED');
      const updated = await tx.supplierProductMap.update({
        where: { id: m.id },
        data: { status: 'UNRESOLVED', suggestedProductId: null, suggestedKind: null, suggestionSource: null },
      });
      await tx.supplierProductMapEvent.create({
        data: {
          mapId: m.id, action: 'REVERTED', fromStatus: m.status, toStatus: 'UNRESOLVED',
          fromKind: m.kind, toKind: null, fromProductId: m.productId, toProductId: null,
          reason: reason ?? `sugestão descartada (${m.suggestionSource ?? '-'}: ${m.suggestedProductId ?? m.suggestedKind ?? '-'})`, actorId,
        },
      });
      return updated;
    });
  }

  /** Reabrir um par CONFIRMED para reavaliação (mantém o vínculo anterior e a trilha). */
  async flagReview(companyId: string, ref: PairRef, actorId: string | null, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('REVIEW exige razão');
    return this.prisma.$transaction(async (tx) => {
      const m = await this.ensureMap(tx, companyId, ref);
      this.assertTransition(m.status, 'REVIEW');
      const updated = await tx.supplierProductMap.update({ where: { id: m.id }, data: { status: 'REVIEW', reviewReason: reason } });
      await tx.supplierProductMapEvent.create({
        data: {
          mapId: m.id, action: 'REVIEW_FLAGGED', fromStatus: m.status, toStatus: 'REVIEW',
          fromKind: m.kind, toKind: m.kind, fromProductId: m.productId, toProductId: m.productId, reason, actorId,
        },
      });
      return updated;
    });
  }

  /**
   * Gatilho automático de REVIEW: para pares CONFIRMED, se a descrição mais
   * recente diverge da confirmada (`descriptionDiverges`). Só sinaliza — nunca
   * desfaz o vínculo. Idempotente (já em REVIEW não repete).
   */
  async detectDivergences(companyId: string): Promise<Array<{ mapId: string; supplierProductCode: string; confirmed: string | null; incoming: string | null }>> {
    const views = await this.buildViews(companyId);
    const maps = await this.prisma.supplierProductMap.findMany({ where: { companyId, status: 'CONFIRMED' }, select: { id: true, supplierId: true, supplierProductCode: true, confirmedDescription: true } });
    const out: Array<{ mapId: string; supplierProductCode: string; confirmed: string | null; incoming: string | null }> = [];
    for (const m of maps) {
      const v = views.find((x) => x.supplierId === m.supplierId && x.supplierProductCode === m.supplierProductCode);
      if (v && descriptionDiverges(m.confirmedDescription, v.lastDescription)) {
        out.push({ mapId: m.id, supplierProductCode: m.supplierProductCode, confirmed: m.confirmedDescription, incoming: v.lastDescription });
      }
    }
    return out;
  }

  // ─── Sugestão por descrição (barata, sem IA; nunca confirma) ───────────────

  /** Só calcula — não escreve. Candidatos claros para pares pendentes sem sugestão. */
  async previewDescriptionSuggestions(companyId: string): Promise<Array<PairRef & { candidate: DescriptionCandidate; totalValue: number; bomRelevant: boolean }>> {
    const [views, products, bomCounts] = await Promise.all([this.buildViews(companyId), this.loadProducts(companyId), this.loadActiveBomCounts(companyId)]);
    const list = [...products.values()];
    const out: Array<PairRef & { candidate: DescriptionCandidate; totalValue: number; bomRelevant: boolean }> = [];
    for (const v of views) {
      if (!v.needsDecision || v.suggestion) continue;
      const c = suggestByDescription(v.lastDescription, list);
      if (c) out.push({ supplierId: v.supplierId, supplierProductCode: v.supplierProductCode, candidate: c, totalValue: v.totalValue, bomRelevant: bomCounts.has(c.productId) });
    }
    return out.sort((a, b) => Number(b.bomRelevant) - Number(a.bomRelevant) || b.totalValue - a.totalValue);
  }

  /** Aplica a prévia como SUGGESTED (source DESCRIPTION). Nunca CONFIRMED. */
  async applyDescriptionSuggestions(companyId: string, actorId?: string | null): Promise<{ suggested: number; failed: number }> {
    const preview = await this.previewDescriptionSuggestions(companyId);
    let suggested = 0;
    let failed = 0;
    for (const p of preview) {
      try {
        await this.suggest(companyId, { supplierId: p.supplierId, supplierProductCode: p.supplierProductCode }, { productId: p.candidate.productId, source: 'DESCRIPTION', rationale: p.candidate.rationale }, actorId ?? null);
        suggested++;
      } catch (err) {
        failed++;
        this.logger.warn(`Sugestão por descrição falhou para (${p.supplierId}, ${p.supplierProductCode}): ${(err as Error).message}`);
      }
    }
    return { suggested, failed };
  }

  /** Utilitário para testes/relatórios: chave do par. */
  static key(ref: PairRef): string {
    return pairKey(ref.supplierId, ref.supplierProductCode);
  }
}
