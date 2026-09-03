/**
 * Seed ESTRUTURAL (o que `prisma db seed` / `npm run db:seed` executa).
 *
 * Conteúdo: cClassTrib + IAM v2 + planos SaaS — ver `seeds/structural.seed.ts`.
 * Não cria empresa, usuário nem dado de demonstração. Para um banco de
 * desenvolvimento vazio, rode em seguida `npm run db:seed:demo`.
 *
 * Produção: bloqueado sem ALLOW_PROD_SEED=true (ver `seeds/seed-guard.ts`).
 */
import { PrismaClient } from '@prisma/client';
import { runStructuralSeed } from './seeds/runners';

const prisma = new PrismaClient();

runStructuralSeed(prisma)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
