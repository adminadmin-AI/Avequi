/**
 * Runner standalone do seed de IAM (permissões + perfis + espelhamento).
 * Uso: `npm run db:seed:iam` — não mexe nos demais dados do seed estrutural.
 *
 * Mesma proteção do seed estrutural: em produção só roda com
 * ALLOW_PROD_SEED=true (reconcilia perfis system e permissões reais).
 */
import { PrismaClient } from '@prisma/client';
import { runIamSeed } from './seeds/runners';

const prisma = new PrismaClient();

runIamSeed(prisma)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
