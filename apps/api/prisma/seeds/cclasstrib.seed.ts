/**
 * Seed ESTRUTURAL — tabela oficial cClassTrib IBS/CBS (#413).
 * Sincroniza o catálogo versionado em código com o banco (upsert por code).
 * Não cria empresa, usuário nem dado de demonstração.
 */
import { PrismaClient } from '@prisma/client';
import { CCLASSTRIB_TABLE } from '../../src/modules/tax/data/cclasstrib.data';

export async function seedCclasstrib(prisma: PrismaClient): Promise<number> {
  const EXEMPT_CSTS = ['400', '410'];
  const REDUCED_CSTS = ['011', '200', '222', '515'];
  for (const entry of CCLASSTRIB_TABLE) {
    const ctData = {
      description: entry.description,
      cst: entry.cst,
      percRedIbs: entry.percRedIbs,
      percRedCbs: entry.percRedCbs,
      isExempt: EXEMPT_CSTS.includes(entry.cst),
      isReduced: REDUCED_CSTS.includes(entry.cst) || entry.percRedIbs > 0 || entry.percRedCbs > 0,
      isMonophase: entry.isMonophase,
      allowsCredPres: entry.allowsCredPres,
      allowsNfe: entry.allowsNfe,
      validFrom: entry.validFrom ? new Date(entry.validFrom) : null,
      validTo: entry.validTo ? new Date(entry.validTo) : null,
    };
    await prisma.tributaryClassification.upsert({
      where: { code: entry.code },
      update: ctData,
      create: { code: entry.code, ...ctData },
    });
  }
  console.log(`✅ cClassTrib: ${CCLASSTRIB_TABLE.length} códigos sincronizados`);
  return CCLASSTRIB_TABLE.length;
}
