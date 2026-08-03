/**
 * BACKFILL #347-B — filiais (gdr_branches) e vínculo depósito→filial
 * (Warehouse.branchId), POR EMPRESA e SOMENTE com plano aprovado.
 *
 * ⚠️ NÃO EXISTE PLANO APROVADO EMBUTIDO NESTE SCRIPT — de propósito.
 * A revisão read-only de 03/08/2026 constatou que o retrato real de produção
 * NÃO bate com o rascunho de mapeamento discutido em 01/08:
 *   - GDR Reboques (…0115) possui apenas ALM-FAB;
 *   - LOJA-GUA pertence a OUTRA empresa (GDR Guarapuava, …0204);
 *   - LOJA-CAS não existe em nenhuma empresa;
 *   - existe uma empresa demonstrativa "GDR Matriz" com CNPJ fictício
 *     (ALM-01/EXP-01, zero vendas — ver limpeza #730).
 * O plano definitivo precisa ser decidido pelo Rafael, POR EMPRESA, a partir
 * do retrato que este script imprime.
 *
 * Modos:
 *   npx tsx apps/api/scripts/backfill-warehouse-branches-347b.ts
 *       → RETRATO (default): lista empresas, depósitos, filiais e vínculos
 *         atuais. Não recebe plano, não grava nada, não tem modo apply.
 *
 *   npx tsx ... --plano caminho/plano.json
 *       → DRY-RUN do plano: imprime o que seria criado/vinculado. Nada grava.
 *
 *   npx tsx ... --plano caminho/plano.json --apply
 *       → aplica o plano. `--apply` sem `--plano` é ERRO: não existe plano
 *         implícito para executar por acidente.
 *
 * Formato do plano (JSON, um objeto por empresa — decidido e aprovado pelo
 * Rafael antes de qualquer apply):
 *   [
 *     {
 *       "empresaCnpj": "46247069000115",
 *       "filiais":  [ { "code": "MATRIZ", "name": "Matriz (Fábrica)" } ],
 *       "vinculos": [ { "warehouseCode": "ALM-FAB", "filialCode": "MATRIZ" } ]
 *     }
 *   ]
 *
 * Garantias (fail-closed):
 *   - empresa do plano inexistente → ERRO (nada da entrada é processado);
 *   - depósito do plano inexistente NA empresa → ERRO (não "pula" silencioso);
 *   - depósito só é procurado DENTRO da empresa da entrada — depósito de
 *     outra empresa jamais é considerado;
 *   - filial já existente (companyId+code) é reaproveitada SEM renomear;
 *   - depósito já vinculado à filial certa → skip; vinculado a OUTRA →
 *     divergência: reporta, NÃO altera, exit 1;
 *   - depósito da empresa fora do plano → reportado como "sem plano";
 *   - nunca deleta nada; nunca toca UserRoleAssignment (o recorte só ativa
 *     quando o admin der filial a um usuário — etapa posterior e manual);
 *   - idempotente: reexecutar o mesmo plano só reporta "já correto".
 *
 * ⚠️ Execução com --apply em ambiente do ERP é etapa operacional separada e
 *    exige autorização específica do Rafael sobre um plano aprovado.
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PlanoEmpresa {
  empresaCnpj: string;
  filiais: Array<{ code: string; name: string }>;
  vinculos: Array<{ warehouseCode: string; filialCode: string }>;
}

function lerPlano(caminho: string): PlanoEmpresa[] {
  const raw = JSON.parse(readFileSync(caminho, 'utf-8'));
  if (!Array.isArray(raw)) throw new Error('Plano inválido: esperado um array de empresas');
  for (const e of raw) {
    if (!e?.empresaCnpj || !Array.isArray(e.filiais) || !Array.isArray(e.vinculos)) {
      throw new Error('Plano inválido: cada entrada exige empresaCnpj, filiais[] e vinculos[]');
    }
  }
  return raw as PlanoEmpresa[];
}

/** RETRATO: o estado atual, para o Rafael decidir o plano. Nunca grava. */
async function imprimirRetrato() {
  console.log('RETRATO ATUAL (nenhuma alteração é feita neste modo)\n');
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, cnpj: true },
    orderBy: { name: 'asc' },
  });
  for (const c of companies) {
    console.log(`■ ${c.name} (CNPJ ${c.cnpj})`);
    const branches = await prisma.branch.findMany({
      where: { companyId: c.id },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
    console.log(
      branches.length
        ? `  filiais: ${branches.map((b) => `${b.code} "${b.name}"`).join(', ')}`
        : '  filiais: (nenhuma)',
    );
    const whs = await prisma.warehouse.findMany({
      where: { companyId: c.id },
      select: { code: true, name: true, isActive: true, branch: { select: { code: true } } },
      orderBy: { code: 'asc' },
    });
    for (const w of whs) {
      const vinc = w.branch ? `→ filial ${w.branch.code}` : '→ SEM vínculo';
      console.log(`  depósito ${w.code.padEnd(10)} "${w.name}" ${vinc}${w.isActive ? '' : ' [INATIVO]'}`);
    }
    if (whs.length === 0) console.log('  depósitos: (nenhum)');
    console.log('');
  }
  console.log('Próximo passo: Rafael decide o plano POR EMPRESA (JSON no formato do');
  console.log('cabeçalho) → dry-run com --plano → autorização → --apply.');
}

async function executarPlano(plano: PlanoEmpresa[], apply: boolean) {
  console.log(`Backfill #347-B — ${apply ? 'MODO APPLY' : 'DRY-RUN do plano (nada será gravado)'}\n`);
  let divergencias = 0;

  for (const entrada of plano) {
    const company = await prisma.company.findFirst({
      where: { cnpj: entrada.empresaCnpj },
      select: { id: true, name: true, cnpj: true },
    });
    if (!company) throw new Error(`Empresa com CNPJ ${entrada.empresaCnpj} não encontrada — nada desta entrada foi processado`);
    console.log(`■ ${company.name} (${company.cnpj})`);

    const filialPorCode = new Map<string, { id: string } | null>();
    for (const f of entrada.filiais) {
      const existente = await prisma.branch.findUnique({
        where: { companyId_code: { companyId: company.id, code: f.code } },
        select: { id: true, name: true },
      });
      if (existente) {
        console.log(`  = filial ${f.code} já existe ("${existente.name}") — reaproveitada sem renomear`);
        filialPorCode.set(f.code, existente);
      } else {
        console.log(`  + filial ${f.code} "${f.name}" será criada`);
        filialPorCode.set(
          f.code,
          apply
            ? await prisma.branch.create({
                data: { companyId: company.id, code: f.code, name: f.name },
                select: { id: true },
              })
            : null,
        );
      }
    }

    for (const v of entrada.vinculos) {
      // Depósito procurado SOMENTE dentro da empresa desta entrada
      const wh = await prisma.warehouse.findFirst({
        where: { companyId: company.id, code: v.warehouseCode },
        select: { id: true, code: true, name: true, branchId: true, branch: { select: { code: true } } },
      });
      if (!wh) {
        throw new Error(
          `Depósito ${v.warehouseCode} não existe na empresa ${company.name} — plano desatualizado, corrigir antes de prosseguir`,
        );
      }
      if (!filialPorCode.has(v.filialCode)) {
        throw new Error(`Vínculo ${v.warehouseCode}→${v.filialCode}: filial ${v.filialCode} não está declarada no plano da empresa`);
      }
      const filial = filialPorCode.get(v.filialCode);
      if (wh.branchId && wh.branch?.code === v.filialCode) {
        console.log(`  = ${wh.code} já vinculado a ${v.filialCode}`);
        continue;
      }
      if (wh.branchId && wh.branch?.code !== v.filialCode) {
        divergencias++;
        console.log(`  ! ${wh.code} vinculado a OUTRA filial (${wh.branch?.code}) — divergência, NÃO alterado`);
        continue;
      }
      console.log(`  → ${wh.code} "${wh.name}" será vinculado à filial ${v.filialCode}`);
      if (apply && filial) {
        await prisma.warehouse.update({ where: { id: wh.id }, data: { branchId: filial.id } });
      }
    }

    const foraDoPlano = await prisma.warehouse.findMany({
      where: { companyId: company.id, code: { notIn: entrada.vinculos.map((v) => v.warehouseCode) } },
      select: { code: true },
    });
    for (const w of foraDoPlano) console.log(`  ? ${w.code} sem plano — não será tocado`);
    console.log('');
  }

  console.log('Lembrete: isto NÃO ativa recorte para ninguém — o escopo só vale para o');
  console.log('usuário que receber assignment com branchId (etapa posterior, via admin).');
  process.exitCode = divergencias > 0 ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  const planoIdx = args.indexOf('--plano');
  const apply = args.includes('--apply');
  const conhecidos = new Set(['--plano', '--apply']);
  const desconhecidos = args.filter((a, i) => !conhecidos.has(a) && !(planoIdx >= 0 && i === planoIdx + 1));
  if (desconhecidos.length > 0) {
    throw new Error(`Argumento desconhecido: ${desconhecidos.join(' ')} — aceitos: --plano <arquivo.json>, --apply`);
  }
  if (apply && planoIdx < 0) {
    throw new Error('--apply exige --plano <arquivo.json>: não existe plano implícito para aplicar');
  }
  if (planoIdx >= 0) {
    const caminho = args[planoIdx + 1];
    if (!caminho || caminho.startsWith('--')) throw new Error('--plano exige o caminho de um arquivo JSON');
    await executarPlano(lerPlano(caminho), apply);
  } else {
    await imprimirRetrato();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
