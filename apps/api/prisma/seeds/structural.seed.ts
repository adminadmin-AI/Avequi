/**
 * Seed ESTRUTURAL — Onda 0, higiene do seed IAM.
 *
 * Só o que precisa existir em QUALQUER ambiente para o produto funcionar e
 * que é versionado em código:
 *   1. tabela oficial cClassTrib IBS/CBS (#413);
 *   2. IAM v2: catálogo de permissões + perfis system + espelhamento (#338/#339);
 *   3. planos do SaaS (OPS WP4, #911).
 *
 * NÃO cria Company, User, produto, cliente, fornecedor nem qualquer dado de
 * demonstração — isso vive em `demo.seed.ts`. Administrador real de tenant
 * nasce pelo convite de tenant (OPS WP2, #909).
 *
 * Idempotente. Execução: `npm run db:seed` (= `prisma db seed`).
 */
import { PrismaClient } from '@prisma/client';
import { seedCclasstrib } from './cclasstrib.seed';
import { seedIam, IamSeedSummary } from './iam.seed';
import { seedPlans } from './plans.seed';

export interface StructuralSeedSummary {
  cclasstribCodes: number;
  iam: IamSeedSummary;
  plansUpserted: number;
}

export async function seedStructural(prisma: PrismaClient): Promise<StructuralSeedSummary> {
  const cclasstribCodes = await seedCclasstrib(prisma);
  console.log(`✅ cClassTrib: ${cclasstribCodes} códigos sincronizados`);

  const iam = await seedIam(prisma);

  const plansUpserted = await seedPlans(prisma);

  console.log('✅ Seed estrutural concluído');
  return { cclasstribCodes, iam, plansUpserted };
}
