/**
 * Estimativa READ-ONLY da cobertura de conciliação (Fase 2, PR-2 · #609).
 *
 * Só leitura: FiscalDocumentItem/FiscalDocument, Product, BomItem/BomVersion.
 * NÃO lê nem escreve SupplierProductMap (a migration pode não estar aplicada).
 * Usa o mesmo núcleo puro do serviço (aggregate.ts) para responder:
 *   - total de pares (companyId, supplierId, cProd) autorizados e valor;
 *   - quantos pares (por valor) para ~80 % do valor;
 *   - componentes comprados das BOMs ativas;
 *   - quantos pares a sugestão por descrição ligaria a componentes de BOM ativa.
 *
 *   DATABASE_URL=... npx ts-node -T scripts/spm-coverage-estimate.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  PURCHASED_COMPONENT_TYPES,
  aggregatePairs,
  suggestByDescription,
} from '../src/modules/purchase/supplier-product-map.aggregate';

async function main() {
  const prisma = new PrismaClient();
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const c of companies) {
    const items = await prisma.fiscalDocumentItem.findMany({
      where: { fiscalDocument: { companyId: c.id, direction: 'RECEBIDA', supplierId: { not: null } } },
      select: { productCode: true, productName: true, ncm: true, unit: true, quantity: true, unitPrice: true, totalPrice: true, fiscalDocument: { select: { id: true, status: true, supplierId: true, issueDate: true } } },
    });
    if (items.length === 0) continue;
    const pairs = aggregatePairs(items.map((i) => ({
      documentId: i.fiscalDocument.id, documentStatus: i.fiscalDocument.status, supplierId: i.fiscalDocument.supplierId, issueDate: i.fiscalDocument.issueDate,
      productCode: i.productCode, productName: i.productName, ncm: i.ncm, unit: i.unit, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), totalPrice: Number(i.totalPrice),
    })));
    const total = pairs.reduce((s, p) => s + p.totalValue, 0);
    const sorted = [...pairs].sort((a, b) => b.totalValue - a.totalValue);
    const needed = (pct: number) => { let cum = 0, n = 0; for (const p of sorted) { cum += p.totalValue; n++; if (cum >= total * pct) break; } return n; };
    const bom = await prisma.bomItem.groupBy({ by: ['componentId'], where: { bomVersion: { companyId: c.id, isActive: true } }, _count: { bomVersionId: true } });
    const bomIds = new Set(bom.map((b) => b.componentId));
    const products = await prisma.product.findMany({ where: { companyId: c.id }, select: { id: true, sku: true, name: true, type: true, isActive: true } });
    const purchasedBomComponents = products.filter((p) => bomIds.has(p.id) && (PURCHASED_COMPONENT_TYPES as readonly string[]).includes(p.type));
    let suggested = 0, suggestedBom = 0, suggestedValue = 0;
    const bomHits = new Set<string>();
    for (const p of pairs) {
      const cand = suggestByDescription(p.lastDescription, products);
      if (!cand) continue;
      suggested++; suggestedValue += p.totalValue;
      if (bomIds.has(cand.productId)) { suggestedBom++; bomHits.add(cand.productId); }
    }
    console.log(`\n=== ${c.name} (${c.id})`);
    console.log(`itens lidos: ${items.length} · pares AUTHORIZED: ${pairs.length} · valor: R$ ${total.toFixed(2)} · pares 1x: ${pairs.filter((p) => p.documentCount === 1).length}`);
    console.log(`pares para 50/80/90% do valor: ${needed(0.5)} / ${needed(0.8)} / ${needed(0.9)}`);
    console.log(`BOMs ativas: componentes distintos ${bomIds.size} · comprados (RAW/COMPONENT/CONSUMABLE): ${purchasedBomComponents.length}`);
    console.log(`sugestão por descrição (prévia, nada gravado): ${suggested} pares (R$ ${suggestedValue.toFixed(2)}, ${total ? ((suggestedValue / total) * 100).toFixed(1) : 0}%) · ${suggestedBom} apontam para componente de BOM ativa · ${bomHits.size}/${purchasedBomComponents.length} componentes comprados alcançados`);
    console.log(`componentes comprados de BOM ativa SEM candidato por descrição: ${purchasedBomComponents.filter((p) => !bomHits.has(p.id)).length}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
