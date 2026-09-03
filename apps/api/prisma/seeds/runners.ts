/**
 * Runners dos seeds — a única porta de entrada dos scripts `prisma/seed*.ts`.
 *
 * Cada runner aplica o guard ANTES da primeira query: NODE_ENV + endpoint
 * aparente de DATABASE_URL (só loopback conta como local; qualquer outro host
 * é fail-closed). A URL não prova o banco por trás (túnel/proxy): por isso o
 * demo ainda faz preflight read-only do conteúdo dentro de `seedDemo`. Os
 * scripts só instanciam o PrismaClient e chamam o runner.
 */
import { PrismaClient } from '@prisma/client';
import { seedDemo, DemoSeedSummary } from './demo.seed';
import { seedIam, IamSeedSummary } from './iam.seed';
import { assertSeedAllowed, SeedEnv } from './seed-guard';
import { seedStructural, StructuralSeedSummary } from './structural.seed';

/** `npm run db:seed` — cClassTrib + IAM v2 + planos. NODE_ENV=production OU endpoint não-loopback exigem ALLOW_PROD_SEED=true. */
export async function runStructuralSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<StructuralSeedSummary> {
  assertSeedAllowed('structural', env);
  return seedStructural(prisma);
}

/** `npm run db:seed:iam` — só IAM v2. Mesma proteção do estrutural (production ou não-loopback → ALLOW_PROD_SEED=true). */
export async function runIamSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<IamSeedSummary> {
  assertSeedAllowed('structural', env);
  return seedIam(prisma);
}

/**
 * `npm run db:seed:demo` — dados fictícios. Exige NODE_ENV=development exato,
 * loopback aparente e CONFIRM_DEMO_SEED=true; `seedDemo` repete o guard e faz
 * o preflight read-only do conteúdo antes de escrever.
 */
export async function runDemoSeed(prisma: PrismaClient, env: SeedEnv = process.env): Promise<DemoSeedSummary> {
  assertSeedAllowed('demo', env); // defesa em profundidade: seedDemo aplica de novo
  return seedDemo(prisma, env);
}
