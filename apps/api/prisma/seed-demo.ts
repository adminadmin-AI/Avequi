/**
 * Runner do seed de DEMONSTRAÇÃO / desenvolvimento.
 * Uso: `SEED_USER_PASSWORD=... npm run db:seed:demo` — depois do `db:seed`.
 *
 * Cria empresas, usuários e catálogo FICTÍCIOS (`seeds/demo.seed.ts`).
 * Só roda com NODE_ENV≠production E DATABASE_URL em loopback (localhost /
 * 127.0.0.1 / ::1). Produção ou qualquer banco remoto: bloqueado, sem override.
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
