/**
 * Runner do seed de DEMONSTRAÇÃO / desenvolvimento.
 * Uso: `NODE_ENV=development CONFIRM_DEMO_SEED=true SEED_USER_PASSWORD=... npm run db:seed:demo`
 * — depois do `db:seed`.
 *
 * Cria empresas, usuários e catálogo FICTÍCIOS (`seeds/demo.seed.ts`).
 * Exige NODE_ENV=development exato, DATABASE_URL com loopback aparente
 * (localhost / 127.0.0.1 / ::1) e CONFIRM_DEMO_SEED=true. Como um localhost
 * pode ser túnel/proxy, `seedDemo` ainda faz preflight read-only do conteúdo
 * e bloqueia se houver Company/User não-demo. Sem override.
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
