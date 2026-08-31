/**
 * Bootstrap Avequi — sugestões de SupplierProductMap a partir do
 * `Mapeamento_Nota_Item` do producao_v2 (PR-3 da Fase 2, #609).
 *
 * FERRAMENTA DE MIGRAÇÃO, descartável e reexecutável. O ERP não depende dela.
 *
 *  - dry-run é o PADRÃO: sem --commit não executa nenhum INSERT/UPDATE;
 *  - --commit exige evidência de dry-run do MESMO dia com o conjunto NOMINAL
 *    idêntico (mesmo padrão de import-received-nfe-xml.ts);
 *  - escreve SOMENTE via SupplierProductMapService.suggest (transação +
 *    SupplierProductMapEvent), que nunca passa de SUGGESTED;
 *  - nunca: CONFIRMED, kind/productId canônico, UPDATE de decisão humana,
 *    sobrescrever sugestão diferente, criar Product/Supplier, tocar
 *    FiscalDocumentItem, match cross-tenant;
 *  - idempotente: mesma sugestão já registrada ⇒ UNCHANGED.
 *
 * Fonte legada = TSV exportado do DB_Financeiro (SQL Server), colunas
 * Id, DescricaoNota, Ocorrencias, TipoMapeamento, Codigo — gerado por:
 *   SELECT m.Id, m.DescricaoNota, m.Ocorrencias, m.TipoMapeamento,
 *          COALESCE(p.Codigo, mp.Codigo) AS Codigo
 *   FROM Mapeamento_Nota_Item m
 *   LEFT JOIN Pecas p ON p.Id = m.PecaId
 *   LEFT JOIN Materia_Prima mp ON mp.Id = m.MateriaPrimaId
 *
 * Uso:
 *   DATABASE_URL=... npx ts-node -T scripts/seed-supplier-product-map-producao-v2.ts \
 *     --source <legado.tsv> [--report <dir>] [--company <companyId>] [--commit]
 */
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { aggregatePairs, normalizeSupplierProductCode } from '../src/modules/purchase/supplier-product-map.aggregate';
import {
  ExistingMapState,
  LegacyRow,
  SEED_SOURCE,
  SeedPlanItem,
  TenantProduct,
  indexLegacy,
  indexProducts,
  nominalEvidence,
  parseLegacyTsv,
  planSeed,
  summarizeSeed,
} from '../src/modules/purchase/seed-producao-v2.core';
import { SupplierProductMapService } from '../src/modules/purchase/supplier-product-map.service';

interface Args { source: string; report: string; company?: string; commit: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { source: '', report: path.join(process.cwd(), 'reports', 'seed-producao-v2'), commit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--company') args.company = argv[++i];
    else if (a === '--commit') args.commit = true;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!args.source) throw new Error('--source <legado.tsv> é obrigatório');
  return args;
}

const PURCHASED_TYPES = new Set(['RAW_MATERIAL', 'COMPONENT', 'CONSUMABLE']);

/**
 * EXCLUSÕES NOMINAIS do legado (decisão humana, versionada aqui — não depende
 * de flag no dia do commit). A linha continua íntegra no DB_Financeiro/TSV;
 * o bootstrap apenas recusa usá-la como sugestão (SKIPPED_MANUAL_EXCLUSION).
 */
const LEGACY_EXCLUSIONS = new Map<string, string>([
  ['225', 'ARRUELA 1/4 LISA não corresponde à Arruela do Francês 3/8; exclusão confirmada após auditoria física em 25/08/2026 (Rafael)'],
]);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const legacy: LegacyRow[] = parseLegacyTsv(fs.readFileSync(args.source, 'utf-8'));
  const legacyIdx = indexLegacy(legacy);
  const executedAt = new Date().toISOString();
  fs.mkdirSync(args.report, { recursive: true });

  const companies = await prisma.company.findMany({ where: args.company ? { id: args.company } : {}, select: { id: true, name: true } });
  // Products de TODOS os tenants: o índice é por (companyId, sku); o planejador usa isso só para distinguir "outro tenant" de "inexistente"
  const allProducts: TenantProduct[] = (await prisma.product.findMany({ select: { id: true, companyId: true, sku: true, name: true, isActive: true } }));
  const productIdx = indexProducts(allProducts);

  const plans: SeedPlanItem[] = [];
  const perCompany: Record<string, unknown> = {};
  let mapsTableMissing = false;

  for (const c of companies) {
    const items = await prisma.fiscalDocumentItem.findMany({
      where: { fiscalDocument: { companyId: c.id, direction: 'RECEBIDA', supplierId: { not: null } } },
      select: { productCode: true, productName: true, ncm: true, unit: true, quantity: true, unitPrice: true, totalPrice: true, fiscalDocument: { select: { id: true, status: true, supplierId: true, issueDate: true } } },
    });
    if (items.length === 0) continue;
    const rows = items.map((i) => ({
      documentId: i.fiscalDocument.id, documentStatus: i.fiscalDocument.status, supplierId: i.fiscalDocument.supplierId, issueDate: i.fiscalDocument.issueDate,
      productCode: i.productCode, productName: i.productName, ncm: i.ncm, unit: i.unit, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), totalPrice: Number(i.totalPrice),
    }));
    const metrics = aggregatePairs(rows);
    // todas as descrições vistas por par (autorizadas): o legado casa por descrição
    const descByKey = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.documentStatus !== 'AUTHORIZED' || !r.supplierId) continue;
      const code = normalizeSupplierProductCode(r.productCode); if (!code) continue;
      const k = `${r.supplierId} ${code}`;
      if (!descByKey.has(k)) descByKey.set(k, new Set());
      descByKey.get(k)!.add(r.productName);
    }
    const pairs = metrics.map((m) => ({ ...m, descriptions: [...(descByKey.get(`${m.supplierId} ${m.supplierProductCode}`) ?? [])] }));

    let existing = new Map<string, ExistingMapState>();
    try {
      // list-lint: ok (script de bootstrap one-shot: precisa de todos os mapas do tenant para respeitar a precedência humano > sugestão > seed)
      const maps = await prisma.supplierProductMap.findMany({ where: { companyId: c.id } });
      existing = new Map(maps.map((m) => [`${m.supplierId} ${m.supplierProductCode}`, {
        status: m.status as ExistingMapState['status'], kind: (m.kind as ExistingMapState['kind']) ?? null, productId: m.productId,
        suggestedProductId: m.suggestedProductId, suggestedKind: (m.suggestedKind as ExistingMapState['suggestedKind']) ?? null, suggestionSource: m.suggestionSource,
      }]));
    } catch (err) {
      if ((err as { code?: string }).code === 'P2021') { mapsTableMissing = true; console.warn(`AVISO: tabela gdr_supplier_product_maps ausente (migration 20260824230000 não aplicada) — precedência avaliada como "sem mapa". --commit é impossível neste banco.`); }
      else throw err;
    }

    const plan = planSeed({ companyId: c.id, pairs, legacy: legacyIdx, products: productIdx, existing, exclusions: LEGACY_EXCLUSIONS });
    plans.push(...plan);

    // BOM ativa: componentes comprados (mesmo critério do serviço, simplificado ao tipo + evidência de mapa CONFIRMED)
    const bom = await prisma.bomItem.groupBy({ by: ['componentId'], where: { bomVersion: { companyId: c.id, isActive: true } }, _count: { bomVersionId: true } });
    const bomIds = new Set(bom.map((b) => b.componentId));
    const bomCount = new Map(bom.map((b) => [b.componentId, b._count.bomVersionId]));
    // tipos só dos componentes (o índice global de Products não carrega type)
    const typed = bomIds.size ? await prisma.product.findMany({ where: { companyId: c.id, id: { in: [...bomIds] } }, select: { id: true, sku: true, name: true, type: true } }) : [];
    const purchased = typed.filter((p) => PURCHASED_TYPES.has(p.type));
    const confirmedIds = new Set([...existing.values()].filter((e) => e.status === 'CONFIRMED' && e.productId).map((e) => e.productId as string));
    const summary = summarizeSeed(plan, purchased, confirmedIds);
    perCompany[c.name] = { companyId: c.id, pairs: pairs.length, summary };

    // Artefato para a futura UI: componentes de BOM × pares fiscais × sugestão
    const suggestedBy = new Map<string, SeedPlanItem[]>();
    for (const p of plan) if (p.outcome === 'WOULD_SUGGEST_PRODUCT') { if (!suggestedBy.has(p.suggestedProductId!)) suggestedBy.set(p.suggestedProductId!, []); suggestedBy.get(p.suggestedProductId!)!.push(p); }
    const supplierNames = new Map((await prisma.supplier.findMany({ where: { companyId: c.id }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const artifact = purchased
      .map((comp) => ({
        sku: comp.sku, name: comp.name, type: comp.type, activeBomCount: bomCount.get(comp.id) ?? 0,
        status: suggestedBy.has(comp.id) ? 'COM_SUGESTAO' : 'SEM_SUGESTAO',
        pairs: (suggestedBy.get(comp.id) ?? []).map((p) => ({ supplier: supplierNames.get(p.supplierId) ?? p.supplierId, supplierId: p.supplierId, cProd: p.supplierProductCode, description: p.lastDescription, totalValue: p.totalValue, documents: p.documentCount, lastUnitPrice: metrics.find((m) => m.supplierId === p.supplierId && m.supplierProductCode === p.supplierProductCode)?.lastUnitPrice ?? null, suggestion: { productSku: p.suggestedSku, source: SEED_SOURCE } })),
      }))
      .sort((a, b) => a.status.localeCompare(b.status) || b.activeBomCount - a.activeBomCount);
    fs.writeFileSync(path.join(args.report, `bom-priority-${c.id}.json`), JSON.stringify({ company: c.name, executedAt, note: 'SUGGESTED ≠ CONFIRMED — artefato read-only para desenhar a primeira tela', components: artifact }, null, 1));
  }

  const evidence = nominalEvidence(plans);
  const report = {
    executedAt, mode: args.commit ? 'COMMIT' : 'DRY_RUN', source: path.basename(args.source), legacyRows: legacy.length, legacyDistinctDescriptions: legacyIdx.size,
    companies: perCompany, evidence: { product: evidence.product.length, kind: evidence.kind.length, excluded: evidence.excluded.length }, mapsTableMissing,
    legacyExclusions: [...LEGACY_EXCLUSIONS.entries()].map(([id, reason]) => ({ legacyId: id, reason })),
    samples: {
      ambiguous: plans.filter((p) => p.outcome === 'AMBIGUOUS').slice(0, 10).map((p) => ({ supplierId: p.supplierId, cProd: p.supplierProductCode, reason: p.reason })),
      skippedTenant: plans.filter((p) => p.outcome === 'SKIPPED_TENANT').slice(0, 5).map((p) => ({ companyId: p.companyId, cProd: p.supplierProductCode, reason: p.reason })),
      inactive: plans.filter((p) => p.outcome === 'SKIPPED_INACTIVE_PRODUCT').map((p) => ({ cProd: p.supplierProductCode, reason: p.reason })),
      conflicts: plans.filter((p) => p.outcome.startsWith('CONFLICT')).slice(0, 10).map((p) => ({ cProd: p.supplierProductCode, outcome: p.outcome, reason: p.reason })),
      manualExclusions: plans.filter((p) => p.outcome === 'SKIPPED_MANUAL_EXCLUSION').map((p) => ({ companyId: p.companyId, supplierId: p.supplierId, cProd: p.supplierProductCode, legacyIds: p.legacyIds, reason: p.reason })),
      invalid: plans.filter((p) => p.outcome === 'INVALID').slice(0, 10).map((p) => ({ cProd: p.supplierProductCode, reason: p.reason })),
    },
  };
  fs.writeFileSync(path.join(args.report, `seed-producao-v2-${args.commit ? 'commit' : 'dryrun'}-${executedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify({ ...report, plans }, null, 1));
  console.log(JSON.stringify(report, null, 1));

  const evidencePath = path.join(args.report, '.seed-producao-v2-dryrun.json');
  if (!args.commit) {
    fs.writeFileSync(evidencePath, JSON.stringify({ day: executedAt.slice(0, 10), evidence }));
    console.log(`\nDRY-RUN concluído. Nada foi escrito. Evidência em ${evidencePath}`);
    await prisma.$disconnect();
    return;
  }

  // ── GATE do --commit ──
  if (mapsTableMissing) { console.error('ABORT: tabela de mapas ausente. Nada foi escrito.'); process.exit(2); }
  if (!fs.existsSync(evidencePath)) { console.error('ABORT: --commit exige dry-run prévio (evidência ausente). Nada foi escrito.'); process.exit(2); }
  const ev = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
  if (ev.day !== executedAt.slice(0, 10)) { console.error('ABORT: evidência de dry-run não é de hoje. Rode o dry-run de novo. Nada foi escrito.'); process.exit(2); }
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(ev.evidence?.product ?? [], evidence.product) || !same(ev.evidence?.kind ?? [], evidence.kind) || !same(ev.evidence?.excluded ?? [], evidence.excluded)) {
    console.error('ABORT BEFORE WRITE: conjunto nominal difere da evidência do dry-run. O universo mudou — rode novo dry-run. Nada foi escrito.'); process.exit(2);
  }

  const service = new SupplierProductMapService(prisma as never);
  let ok = 0, failed = 0;
  for (const p of plans) {
    if (p.outcome !== 'WOULD_SUGGEST_PRODUCT' && p.outcome !== 'WOULD_SUGGEST_KIND') continue;
    try {
      await service.suggest(p.companyId, { supplierId: p.supplierId, supplierProductCode: p.supplierProductCode },
        { productId: p.suggestedProductId ?? null, kind: p.suggestedProductId ? 'PRODUCT' : p.suggestedKind ?? null, source: 'SEED_PRODUCAO_V2', rationale: p.rationale }, null);
      ok++;
    } catch (err) { failed++; console.error(`FAILED (${p.supplierId}, ${p.supplierProductCode}): ${(err as Error).message}`); }
  }
  console.log(`\nCOMMIT: SUGGESTED=${ok} FAILED=${failed} (nunca CONFIRMED)`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
