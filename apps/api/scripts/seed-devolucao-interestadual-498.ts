/**
 * #498 — Regras de DEVOLUCAO_VENDA interestadual (CFOP 2202).
 *
 * Com o fim do FALLBACK_RULE, toda operação precisa de regra cadastrada.
 * A devolução interestadual caía na regra genérica 1202 (CFOP de operação
 * interna) — nota errada autorizável. Este seed cria as regras PR→UF com
 * CFOP 2202 espelhando a 1202 (ICMS interestadual 12%).
 *
 * Idempotente (upsert pela unique companyId+operationType+ncm+productType+ufs).
 * Uso: npx tsx apps/api/scripts/seed-devolucao-interestadual-498.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const GDR = '1f885505-37df-426f-b885-2a7ac889763c';
// UFs com regra de venda interestadual cadastrada (o cliente pode devolver de onde compra)
const UFS = ['SP', 'SC', 'RS', 'MG', 'RJ', 'BA', 'GO', 'MT', 'MS'];

async function main() {
  const base = await prisma.taxRule.findFirst({
    where: { companyId: GDR, operationType: 'DEVOLUCAO_VENDA', cfop: '1202', isActive: true },
  });
  if (!base) throw new Error('Regra base 1202 (devolução interna) não encontrada — abortando');

  let created = 0;
  for (const uf of UFS) {
    // upsert não aceita null na unique composta — idempotência via findFirst
    const exists = await prisma.taxRule.findFirst({
      where: { companyId: GDR, operationType: 'DEVOLUCAO_VENDA', ncm: null, productType: null, ufOrigem: 'PR', ufDestino: uf },
    });
    if (exists) continue;
    await prisma.taxRule.create({
      data: {
        companyId: GDR,
        operationType: 'DEVOLUCAO_VENDA',
        ufOrigem: 'PR',
        ufDestino: uf,
        cfop: '2202', // devolução de venda — entrada de outro estado
        icmsCst: base.icmsCst,
        icmsAliquota: 12, // interestadual — espelha a alíquota da venda 6101
        icmsBaseReducao: base.icmsBaseReducao,
        ipiCst: base.ipiCst,
        ipiAliquota: base.ipiAliquota,
        pisCst: base.pisCst,
        pisAliquota: base.pisAliquota,
        cofinsCst: base.cofinsCst,
        cofinsAliquota: base.cofinsAliquota,
        description: `Devolução de venda interestadual PR→${uf} (CFOP 2202) — #498`,
        priority: 10,
        isActive: true,
      },
    });
    created++;
  }
  console.log(`Regras 2202 criadas: ${created} (UFs alvo: ${UFS.join(', ')})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
