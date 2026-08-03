/**
 * BACKFILL #347-B — cria as filiais (gdr_branches) da GDR e vincula cada
 * depósito (Warehouse.branchId) à sua filial física.
 *
 * Mapeamento decidido pelo Rafael (01/08/2026):
 *   ALM-FAB  → MATRIZ (a fábrica é a matriz)
 *   LOJA-CAS → CAS
 *   LOJA-GUA → GUA
 * O NOME da filial é herdado do cadastro do depósito (data-driven — o que
 * estiver no banco é a verdade); o código é a chave estável do mapeamento.
 *
 * O QUE ESTE SCRIPT NÃO FAZ: ele não ativa recorte nenhum. O escopo por
 * filial só passa a valer para um usuário quando o admin der a ele um
 * UserRoleAssignment COM branchId (tela de usuários / etapa posterior).
 * Depósito vinculado + assignment sem branchId = comportamento de sempre.
 *
 * Uso:
 *   npx tsx apps/api/scripts/backfill-warehouse-branches-347b.ts           # dry-run (padrão): só imprime o plano
 *   npx tsx apps/api/scripts/backfill-warehouse-branches-347b.ts --apply   # grava filiais e vínculos
 *   TARGET_COMPANY_CNPJ=00000000000000 npx tsx ... # sobrescreve a empresa
 *
 * Idempotente: filial já existente (companyId+code) é reaproveitada; depósito
 * já vinculado à filial certa é pulado; vinculado a OUTRA filial é reportado
 * como divergência e NÃO é alterado (resolver manualmente).
 *
 * ⚠️ Execução com --apply em ambiente do ERP é etapa operacional separada e
 *    exige autorização específica do Rafael.
 */

import { PrismaClient } from '@prisma/client';
import { GDR_COMPANY_CNPJ } from '../src/modules/production/data/gdr/work-centers.data';

const prisma = new PrismaClient();

/** Depósito (code) → código da filial. Depósito fora do mapa não é tocado. */
const DEPOSITO_PARA_FILIAL: Record<string, string> = {
  'ALM-FAB': 'MATRIZ',
  'LOJA-CAS': 'CAS',
  'LOJA-GUA': 'GUA',
};

/** Nome da filial quando ela precisar ser criada (senão herda o existente). */
function nomeDaFilial(codigoFilial: string, nomeDeposito: string): string {
  return codigoFilial === 'MATRIZ' ? 'Matriz (Fábrica)' : nomeDeposito;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--apply');
  if (unknown.length > 0) {
    throw new Error(`Argumento desconhecido: ${unknown.join(' ')} — aceito: --apply`);
  }
  const apply = args.includes('--apply');
  const targetCnpj = process.env.TARGET_COMPANY_CNPJ?.trim() || GDR_COMPANY_CNPJ;

  console.log(`Backfill #347-B — filiais e vínculo dos depósitos — ${apply ? 'MODO APPLY' : 'DRY-RUN (padrão)'}`);
  console.log(`Empresa de destino: CNPJ ${targetCnpj} (igualdade exata)\n`);

  const company = await prisma.company.findFirst({
    where: { cnpj: targetCnpj },
    select: { id: true, name: true, cnpj: true },
  });
  if (!company) throw new Error(`Empresa com CNPJ ${targetCnpj} não encontrada`);
  console.log(`Empresa resolvida: ${company.name} (${company.cnpj})\n`);

  const warehouses = await prisma.warehouse.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true, name: true, branchId: true, isActive: true },
    orderBy: { code: 'asc' },
  });

  const relatorio = { filiaisCriadas: 0, vinculados: 0, jaCorretos: 0, divergentes: 0, foraDoMapa: 0 };

  for (const wh of warehouses) {
    const codigoFilial = DEPOSITO_PARA_FILIAL[wh.code];
    if (!codigoFilial) {
      relatorio.foraDoMapa++;
      console.log(`? ${wh.code.padEnd(10)} fora do mapeamento — não será tocado`);
      continue;
    }

    let branch = await prisma.branch.findUnique({
      where: { companyId_code: { companyId: company.id, code: codigoFilial } },
      select: { id: true, name: true },
    });

    if (!branch) {
      const name = nomeDaFilial(codigoFilial, wh.name);
      relatorio.filiaisCriadas++;
      console.log(`+ filial ${codigoFilial.padEnd(8)} "${name}" será criada`);
      if (apply) {
        branch = await prisma.branch.create({
          data: { companyId: company.id, code: codigoFilial, name },
          select: { id: true, name: true },
        });
      }
    }

    if (wh.branchId && branch && wh.branchId !== branch.id) {
      relatorio.divergentes++;
      console.log(`! ${wh.code.padEnd(10)} já vinculado a OUTRA filial (${wh.branchId}) — divergência, não alterado`);
      continue;
    }
    if (wh.branchId && (!branch || wh.branchId === branch.id)) {
      relatorio.jaCorretos++;
      console.log(`= ${wh.code.padEnd(10)} já vinculado a ${codigoFilial}`);
      continue;
    }

    relatorio.vinculados++;
    console.log(`→ ${wh.code.padEnd(10)} "${wh.name}" será vinculado à filial ${codigoFilial}${wh.isActive ? '' : ' [depósito INATIVO]'}`);
    if (apply && branch) {
      await prisma.warehouse.update({ where: { id: wh.id }, data: { branchId: branch.id } });
    }
  }

  console.log(`\n── Resumo ─────────────────────────────────────────────`);
  console.log(`depósitos analisados : ${warehouses.length}`);
  console.log(`filiais criadas      : ${relatorio.filiaisCriadas}`);
  console.log(`vínculos gravados    : ${relatorio.vinculados}${apply ? '' : ' (dry-run: nada foi gravado)'}`);
  console.log(`já corretos          : ${relatorio.jaCorretos}`);
  console.log(`divergências         : ${relatorio.divergentes}`);
  console.log(`fora do mapeamento   : ${relatorio.foraDoMapa}`);
  console.log(
    '\nLembrete: isto NÃO ativa recorte para ninguém — o escopo só vale para o',
  );
  console.log('usuário que receber assignment com branchId (etapa posterior, via admin).');

  process.exitCode = relatorio.divergentes > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
