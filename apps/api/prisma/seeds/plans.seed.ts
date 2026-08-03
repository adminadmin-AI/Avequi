/**
 * Seed dos planos do SaaS — OPS WP4 (#911).
 *
 * IDEMPOTENTE: upsert por `code`; os entitlements dos planos-template são
 * RECONCILIADOS com o catálogo em código (PLAN_TEMPLATES), mesma filosofia
 * do iam.seed (perfil system segue o catálogo). Planos criados manualmente
 * pelo operador (codes fora dos templates) nunca são tocados.
 *
 * NÃO atribui plano a tenant nenhum: tenants existentes seguem legado
 * (planId null = tudo liberado) até o operador atribuir no portal — decisão
 * de migração do WP4, evita derrubar módulo em produção no deploy.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { PLAN_TEMPLATES } from '../../src/modules/entitlement/entitlements.catalog';

export async function seedPlans(prisma: PrismaClient): Promise<number> {
  let upserted = 0;
  for (const template of PLAN_TEMPLATES) {
    await prisma.plan.upsert({
      where: { code: template.code },
      update: {
        name: template.name,
        description: template.description,
        entitlements: template.entitlements as unknown as Prisma.InputJsonValue,
        active: true,
      },
      create: {
        code: template.code,
        name: template.name,
        description: template.description,
        entitlements: template.entitlements as unknown as Prisma.InputJsonValue,
      },
    });
    upserted++;
  }
  console.log(`✅ Plans seed: ${upserted} planos (upsert por code)`);
  return upserted;
}
