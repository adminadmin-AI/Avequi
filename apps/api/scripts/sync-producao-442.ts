/**
 * Sync pós-db-push — checklist pré-produção #442
 *
 * 1. Upsert dos 164 códigos cClassTrib (tabela oficial IT 2025.002)
 * 2. TaxRules de venda existentes ganham IBS/CBS 2026 (CBS 0,9% + IBS UF 0,1%)
 *    — o seed só cria regras novas, não atualiza as que já estão no banco
 * 3. TaxRules de reboque (NCM 8716.39.00): PIS CST 49 / COFINS CST 99 alíq zero
 * 4. Company GDR: endereço oficial da Receita Federal (Rua Antônio Singer, 4075)
 * 5. Produtos de reboque: codigoMarcaModelo 600657 (RENAVAM Carresul)
 *
 * Uso: npx tsx apps/api/scripts/sync-producao-442.ts
 */

import { PrismaClient } from '@prisma/client';
import { CCLASSTRIB_TABLE } from '../src/modules/tax/data/cclasstrib.data';

const prisma = new PrismaClient();

const EXEMPT_CSTS = ['400', '410'];
const REDUCED_CSTS = ['011', '200', '222', '515'];
const GDR_CNPJ = '46247069000115';

async function main() {
  // ─── 1. cClassTrib ─────────────────────────────────────────────────────────
  let ctCreated = 0;
  let ctUpdated = 0;
  for (const e of CCLASSTRIB_TABLE) {
    const data = {
      description: e.description,
      cst: e.cst,
      percRedIbs: e.percRedIbs,
      percRedCbs: e.percRedCbs,
      isExempt: EXEMPT_CSTS.includes(e.cst),
      isReduced: REDUCED_CSTS.includes(e.cst) || e.percRedIbs > 0 || e.percRedCbs > 0,
      isMonophase: e.isMonophase,
      allowsCredPres: e.allowsCredPres,
      allowsNfe: e.allowsNfe,
      validFrom: e.validFrom ? new Date(e.validFrom) : null,
      validTo: e.validTo ? new Date(e.validTo) : null,
    };
    const existing = await prisma.tributaryClassification.findUnique({ where: { code: e.code } });
    if (existing) {
      await prisma.tributaryClassification.update({ where: { code: e.code }, data });
      ctUpdated++;
    } else {
      await prisma.tributaryClassification.create({ data: { code: e.code, ...data } });
      ctCreated++;
    }
  }
  console.log(`✅ cClassTrib: ${ctCreated} criados, ${ctUpdated} atualizados`);

  // ─── 2. IBS/CBS nas TaxRules de venda ──────────────────────────────────────
  const ibsCbs = await prisma.taxRule.updateMany({
    where: { operationType: { in: ['VENDA_INTERNA', 'VENDA_INTERESTADUAL'] as any } },
    data: {
      cClassTrib: '000001',
      cbsCst: '000',
      cbsAliquota: 0.9,
      ibsUfCst: '000',
      ibsUfAliquota: 0.1,
      ibsMunCst: '000',
      ibsMunAliquota: 0,
    },
  });
  console.log(`✅ IBS/CBS 2026 aplicado em ${ibsCbs.count} TaxRules de venda`);

  // ─── 3. PIS/COFINS reais nas regras de reboque ─────────────────────────────
  const cst4999 = await prisma.taxRule.updateMany({
    where: { ncm: '87163900' },
    data: { pisCst: '49', pisAliquota: 0, cofinsCst: '99', cofinsAliquota: 0 },
  });
  console.log(`✅ PIS CST 49 / COFINS CST 99 em ${cst4999.count} regras NCM 8716.39.00`);

  // ─── 4. Endereço oficial da GDR (Receita Federal, consulta 02/07/2026) ─────
  const company = await prisma.company.findFirst({ where: { cnpj: { contains: '46247069' } } });
  if (company) {
    await prisma.company.update({
      where: { id: company.id },
      data: {
        street: 'RUA ANTONIO SINGER',
        number: '4075',
        complement: 'BARRACAO 02',
        neighborhood: 'CAMPO LARGO DA ROSEIRA',
        city: 'SAO JOSE DOS PINHAIS',
        state: 'PR',
        zipCode: '83091-002',
        ibgeCode: '4125506',
      },
    });
    console.log(`✅ Endereço da Company ${company.name} atualizado (Rua Antônio Singer, 4075)`);
  } else {
    console.log('⚠️  Company GDR (46.247.069) não encontrada — verificar CNPJ no banco');
  }

  // ─── 5. RENAVAM nos produtos de reboque ────────────────────────────────────
  const renavam = await prisma.product.updateMany({
    where: { ncm: { in: ['87163900', '8716.39.00'] }, codigoMarcaModelo: null },
    data: { codigoMarcaModelo: '600657' },
  });
  console.log(`✅ codigoMarcaModelo 600657 em ${renavam.count} produtos de reboque`);

  // ─── Verificação ───────────────────────────────────────────────────────────
  const ctTotal = await prisma.tributaryClassification.count();
  const rulesComIbs = await prisma.taxRule.count({ where: { cbsAliquota: { not: null } } });
  const gdr = await prisma.company.findFirst({ where: { cnpj: { contains: '46247069' } }, select: { street: true, number: true, zipCode: true } });
  console.log('\n── Verificação final ──');
  console.log(`cClassTrib no banco: ${ctTotal}`);
  console.log(`TaxRules com IBS/CBS: ${rulesComIbs}`);
  console.log(`Endereço GDR: ${gdr?.street}, ${gdr?.number} — CEP ${gdr?.zipCode}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
