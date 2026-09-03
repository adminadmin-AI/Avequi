/**
 * Runner do seed de DEMONSTRAÇÃO / desenvolvimento.
 * Uso: `SEED_USER_PASSWORD=... npm run db:seed:demo` — depois do `db:seed`.
 *
 * Cria empresas, usuários e catálogo FICTÍCIOS (`seeds/demo.seed.ts`).
 * HARD-BLOCKED em NODE_ENV=production, sem flag de override.
 */
import { PrismaClient } from '@prisma/client';
import { runDemoSeed } from './seeds/runners';

const prisma = new PrismaClient();

runDemoSeed(prisma)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
