/**
 * #507 (épico #506) — Estágios padrão do funil CRM por company.
 *
 * Cria o pipeline padrão em toda company ativa que ainda não tem estágios:
 * Novo → Em atendimento → Proposta → Negociação → Fechado (WON) / Perdido (LOST).
 * Companies que já possuem qualquer PipelineStage são puladas (o funil é
 * customizável por loja — o seed nunca sobrescreve).
 *
 * Idempotente. Uso: npx tsx apps/api/scripts/seed-crm-stages-507.ts
 */
import { PrismaClient, PipelineStageType } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_STAGES: Array<{
  name: string;
  order: number;
  color: string;
  type: PipelineStageType;
}> = [
  { name: 'Novo', order: 0, color: '#3B82F6', type: 'OPEN' },
  { name: 'Em atendimento', order: 1, color: '#F59E0B', type: 'OPEN' },
  { name: 'Proposta', order: 2, color: '#8B5CF6', type: 'OPEN' },
  { name: 'Negociação', order: 3, color: '#EC4899', type: 'OPEN' },
  { name: 'Fechado', order: 4, color: '#22C55E', type: 'WON' },
  { name: 'Perdido', order: 5, color: '#6B7280', type: 'LOST' },
];

async function main() {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, _count: { select: { pipelineStages: true } } },
  });

  for (const company of companies) {
    if (company._count.pipelineStages > 0) {
      console.log(`↷ ${company.name}: já tem ${company._count.pipelineStages} estágios — pulando`);
      continue;
    }
    await prisma.pipelineStage.createMany({
      data: DEFAULT_STAGES.map((s) => ({ ...s, companyId: company.id })),
    });
    console.log(`✓ ${company.name}: ${DEFAULT_STAGES.length} estágios criados`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
