/**
 * Runner standalone do seed de IAM (permissões + perfis + espelhamento).
 * Uso: `npm run db:seed:iam` — não mexe nos demais dados do seed principal.
 */
import { PrismaClient } from '@prisma/client';
import { seedIam } from './seeds/iam.seed';

const prisma = new PrismaClient();

seedIam(prisma)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
