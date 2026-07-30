/**
 * CARGA GDR REBOQUES — importa os setores da fábrica para WorkCenter (#816)
 *
 * Wrapper fino da implantação GDR sobre o núcleo genérico
 * `src/common/production/work-center-import.ts`. Junta:
 *   - dataset da GDR (`src/modules/production/data/gdr/work-centers.data.ts`)
 *   - CNPJ padrão da GDR (legítimo aqui: o nome do comando diz que é carga GDR)
 *   - flags, relatório, exit code e disconnect
 *
 * Outra empresa NÃO usa este script: cria seu próprio dataset e um wrapper
 * equivalente, reutilizando o núcleo sem alterá-lo.
 *
 * Uso:
 *   npx tsx apps/api/scripts/import-work-centers-gdr.ts                       # dry-run (padrão): só imprime o plano
 *   npx tsx apps/api/scripts/import-work-centers-gdr.ts --apply               # grava criações e atualizações
 *   npx tsx apps/api/scripts/import-work-centers-gdr.ts --apply --deactivate-missing
 *                                                                             # ...e desativa (nunca exclui) os ausentes
 *   npx tsx apps/api/scripts/import-work-centers-gdr.ts --deactivate-missing  # continua dry-run: só mostra o que seria desativado
 *   TARGET_COMPANY_CNPJ=00000000000000 npx tsx apps/api/scripts/import-work-centers-gdr.ts
 *                                                                             # sobrescreve a empresa de destino
 *
 * Campos administrados: code (chave), name, description, isActive.
 * NUNCA sobrescreve: capacityHoursPerDay, costPerHour, operatorsCount, efficiencyPct.
 *
 * ⚠️ Execução com --apply em ambiente do ERP é etapa operacional separada e
 *    exige autorização específica. Ver docs/IMPORTADOR-WORK-CENTERS.md.
 */

import { PrismaClient } from '@prisma/client';
import { GDR_COMPANY_CNPJ, GDR_WORK_CENTERS } from '../src/modules/production/data/gdr/work-centers.data';
import { runWorkCenterImport, WorkCenterImportDb } from '../src/common/production/work-center-import';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--apply', '--deactivate-missing'].includes(a));
  if (unknown.length > 0) {
    throw new Error(`Argumento desconhecido: ${unknown.join(' ')} — aceitos: --apply, --deactivate-missing`);
  }
  const apply = args.includes('--apply');
  const deactivateMissing = args.includes('--deactivate-missing');
  const targetCnpj = process.env.TARGET_COMPANY_CNPJ?.trim() || GDR_COMPANY_CNPJ;

  console.log(`Carga GDR — centros de trabalho (#816) — ${apply ? 'MODO APPLY' : 'DRY-RUN (padrão)'}`);
  console.log(`Empresa de destino: CNPJ ${targetCnpj} (igualdade exata)`);
  console.log(`Setores no dataset: ${GDR_WORK_CENTERS.length}\n`);

  const result = await runWorkCenterImport(prisma as unknown as WorkCenterImportDb, GDR_WORK_CENTERS, {
    apply,
    deactivateMissing,
    targetCnpj,
  });

  const { plan } = result;
  console.log(`Empresa resolvida: ${result.company.name} (${result.company.cnpj})\n`);

  console.log(`── Plano ──────────────────────────────────────────────`);
  console.log(`criados     : ${plan.create.length}`);
  for (const wc of plan.create) console.log(`  + ${wc.code}  ${wc.name}  [${wc.isActive ? 'ativo' : 'INATIVO'}]`);
  console.log(`atualizados : ${plan.update.length}`);
  for (const u of plan.update) console.log(`  ~ ${u.code}  ${JSON.stringify(u.changes)}`);
  console.log(`inalterados : ${plan.unchanged.length}`);
  console.log(`ausentes    : ${plan.missing.length}  (no ERP, fora do dataset — nunca excluídos)`);
  for (const wc of plan.missing) {
    const acao = deactivateMissing && wc.isActive ? '→ será desativado (--deactivate-missing)' : '→ apenas relatado';
    console.log(`  ? ${wc.code}  ${wc.name}  [${wc.isActive ? 'ativo' : 'inativo'}]  ${acao}`);
  }
  console.log(`───────────────────────────────────────────────────────\n`);

  if (!result.applied) {
    console.log('DRY-RUN: nenhuma escrita foi feita. Use --apply para gravar.');
    return;
  }
  console.log(`✅ Aplicado: ${result.created} criados, ${result.updated} atualizados, ${result.deactivated} desativados.`);
}

main()
  .catch((e) => {
    // Nunca imprimir DATABASE_URL/credenciais — só a mensagem do erro.
    console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
