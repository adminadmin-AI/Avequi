/**
 * Runners dos seeds — a única porta de entrada dos scripts `prisma/seed*.ts`.
 *
 * Cada runner aplica o guard ANTES da primeira query: NODE_ENV + destino real
 * de DATABASE_URL (só loopback é local; remoto = fail-closed). Os scripts de
 * linha de comando só instanciam o PrismaClient e chamam o runner, então a
 * política é testável sem executar script nenhum.
 */
import { PrismaClient } from '@prisma/client';
import { seedDemo, DemoSeedSummary } from './demo.seed';
import { seedIam, IamSeedSummary } from './iam.seed';
import { assertSeedAllowed, demoPasswordFromEnv, SeedEnv } from './seed-guard';
import { seedStructural, StructuralSeedSummary } from './structural.seed';

/** `npm run db:seed` — cClassTrib + IAM v2 + planos. NODE_ENV=production OU banco remoto exigem ALLOW_PROD_SEED=true. */
export async function runStructuralSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<StructuralSeedSummary> {
  assertSeedAllowed('structural', env);
  return seedStructural(prisma);
}

/** `npm run db:seed:iam` — só IAM v2. Mesma proteção do estrutural (production ou remoto → ALLOW_PROD_SEED=true). */
export async function runIamSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<IamSeedSummary> {
  assertSeedAllowed('structural', env);
  return seedIam(prisma);
}

/** `npm run db:seed:demo` — dados fictícios. Só NODE_ENV≠production E banco em loopback; remoto/produção bloqueiam sem override. */
export async function runDemoSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<DemoSeedSummary> {
  assertSeedAllowed('demo', env);
  const password = demoPasswordFromEnv(env);
  return seedDemo(prisma, { password });
}
