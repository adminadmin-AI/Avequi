/**
 * #962 (épico #958) — Funil SaaS do CRM da operadora.
 *
 * Cria o pipeline de venda do SaaS na company alvo (tenant Avecchi):
 * Lead → Demo → Trial → Proposta → Fechado (WON) / Perdido (LOST).
 * Se a company já possui qualquer PipelineStage, o script PULA (o funil é
 * customizável — o seed nunca sobrescreve, mesma regra do seed-crm-stages-507).
 *
 * Idempotente. A company alvo vem por argumento — sem default de propósito:
 * rodar sem alvo explícito num banco com dezenas de tenants seria convite
 * a criar funil SaaS no tenant errado.
 *
 * Uso: npx tsx apps/api/scripts/seed-crm-stages-saas-962.ts <companyId>
 */
import { PrismaClient, PipelineStageType } from '@prisma/client';

const prisma = new PrismaClient();

const SAAS_STAGES: Array<{
  name: string;
  order: number;
  color: string;
  type: PipelineStageType;
}> = [
  { name: 'Lead', order: 0, color: '#3B82F6', type: 'OPEN' },
  { name: 'Demo', order: 1, color: '#F59E0B', type: 'OPEN' },
  { name: 'Trial', order: 2, color: '#06B6D4', type: 'OPEN' },
  { name: 'Proposta', order: 3, color: '#8B5CF6', type: 'OPEN' },
  { name: 'Fechado', order: 4, color: '#22C55E', type: 'WON' },
  { name: 'Perdido', order: 5, color: '#6B7280', type: 'LOST' },
];

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    console.error('Uso: npx tsx apps/api/scripts/seed-crm-stages-saas-962.ts <companyId>');
    process.exit(1);
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, _count: { select: { pipelineStages: true } } },
  });
  if (!company) {
    console.error(`Company ${companyId} não encontrada`);
    process.exit(1);
  }
  if (company._count.pipelineStages > 0) {
    console.log(`↷ ${company.name}: já tem ${company._count.pipelineStages} estágios — pulando`);
    return;
  }

  await prisma.pipelineStage.createMany({
    data: SAAS_STAGES.map((s) => ({ ...s, companyId: company.id })),
  });
  console.log(`✓ ${company.name}: funil SaaS criado (${SAAS_STAGES.length} estágios)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
