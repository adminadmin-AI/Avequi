import { Injectable } from '@nestjs/common';
import { TaxOperationType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Obrigatoriedade IBS/CBS em produção p/ CRT=3 (NT 2025.002-RTC) */
const REFORMA_DEADLINE = new Date('2026-08-03T00:00:00-03:00');

const ALL_OPERATIONS = Object.values(TaxOperationType);

/**
 * #503 parte 2 — Compliance Center: conformidade fiscal em TEMPO REAL.
 * Consolida o que estava espalhado em issues/planilhas: prontidão pra
 * Reforma (cClassTrib/NCM — rejeição N12-110 a partir de 03/08/2026),
 * cobertura de regras vigentes por operação, saúde de emissão 30d e
 * pendências veiculares (chassi vendido sem BIN). Score ponderado no topo.
 *
 * Só LEITURA — o painel sinaliza, não bloqueia (princípio do épico).
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(companyId: string) {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 3600_000);

    // Lotes de ≤4 queries — 10 em paralelo estouram pool pequeno (P2024;
    // connection_limit=1 no dev e pool compartilhado em prod — lição do #616)
    const [activeProducts, withNcm, withCClassTrib, rulesVigentes] = await Promise.all([
      this.prisma.product.count({ where: { companyId, isActive: true } }),
      this.prisma.product.count({
        where: { companyId, isActive: true, ncm: { not: null } },
      }),
      this.prisma.product.count({
        where: { companyId, isActive: true, cClassTrib: { not: null } },
      }),
      this.prisma.taxRule.count({ where: this.vigenteWhere(companyId, now) }),
    ]);
    const [rulesWithIbsCbs, coverageRaw, emissionByStatus, recentFailures] = await Promise.all([
      this.prisma.taxRule.count({
        where: { ...this.vigenteWhere(companyId, now), cbsAliquota: { not: null } },
      }),
      this.prisma.taxRule.groupBy({
        by: ['operationType'],
        where: this.vigenteWhere(companyId, now),
        _count: { _all: true },
      }),
      this.prisma.fiscalDocument.groupBy({
        by: ['status'],
        where: { companyId, createdAt: { gte: d30 } },
        _count: { _all: true },
      }),
      this.prisma.fiscalDocument.findMany({
        where: { companyId, createdAt: { gte: d30 }, status: { in: ['REJECTED', 'ERROR'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, type: true, status: true, lastError: true, createdAt: true },
      }),
    ]);
    const [soldSerials, soldWithBin] = await Promise.all([
      this.prisma.serialNumber.count({ where: { companyId, status: 'SOLD' } }),
      this.prisma.serialNumber.count({
        where: { companyId, status: 'SOLD', binRegistration: { status: 'REGISTERED' } },
      }),
    ]);

    // ── Reforma Tributária (peso 40) ─────────────────────────────────────────
    const pctNcm = ratio(withNcm, activeProducts);
    const pctClassTrib = ratio(withCClassTrib, activeProducts);
    const pctRulesIbsCbs = ratio(rulesWithIbsCbs, rulesVigentes);
    const reformaScore = pctNcm * 0.3 + pctClassTrib * 0.5 + pctRulesIbsCbs * 0.2;
    const daysLeft = Math.ceil((REFORMA_DEADLINE.getTime() - now.getTime()) / 86_400_000);

    // ── Cobertura de regras por operação (peso 25) ───────────────────────────
    const countByOp = new Map(coverageRaw.map((c) => [c.operationType, c._count._all]));
    const operations = ALL_OPERATIONS.map((op) => ({
      operationType: op,
      activeRules: countByOp.get(op) ?? 0,
      covered: (countByOp.get(op) ?? 0) > 0,
    }));
    const coveredCount = operations.filter((o) => o.covered).length;
    const coverageScore = ratio(coveredCount, ALL_OPERATIONS.length);

    // ── Saúde de emissão 30d (peso 25) ───────────────────────────────────────
    const byStatus = Object.fromEntries(emissionByStatus.map((s) => [s.status, s._count._all]));
    const authorized = byStatus.AUTHORIZED ?? 0;
    const failed = (byStatus.REJECTED ?? 0) + (byStatus.ERROR ?? 0);
    const settled = authorized + failed; // pendentes/processando ficam de fora da taxa
    const emissionScore = settled > 0 ? ratio(authorized, settled) : 1; // sem emissão = sem falha

    // ── Veicular: chassi vendido sem BIN (peso 10) ───────────────────────────
    const soldWithoutBin = soldSerials - soldWithBin;
    const vehicularScore = soldSerials > 0 ? ratio(soldWithBin, soldSerials) : 1;

    const score = Math.round(
      (reformaScore * 0.4 + coverageScore * 0.25 + emissionScore * 0.25 + vehicularScore * 0.1) * 100,
    );

    return {
      generatedAt: now,
      score,
      weights: { reforma: 0.4, ruleCoverage: 0.25, emission30d: 0.25, vehicular: 0.1 },
      reforma: {
        deadline: REFORMA_DEADLINE,
        daysLeft,
        activeProducts,
        withNcm,
        withoutNcm: activeProducts - withNcm,
        withCClassTrib,
        withoutCClassTrib: activeProducts - withCClassTrib,
        rulesVigentes,
        rulesWithIbsCbs,
        score: Math.round(reformaScore * 100),
      },
      ruleCoverage: {
        operations,
        coveredCount,
        totalOperations: ALL_OPERATIONS.length,
        score: Math.round(coverageScore * 100),
      },
      emission30d: {
        authorized,
        rejected: byStatus.REJECTED ?? 0,
        error: byStatus.ERROR ?? 0,
        pending: (byStatus.PENDING ?? 0) + (byStatus.PROCESSING ?? 0),
        cancelled: byStatus.CANCELLED ?? 0,
        total: emissionByStatus.reduce((s, x) => s + x._count._all, 0),
        successRate: Math.round(emissionScore * 100),
        recentFailures,
        score: Math.round(emissionScore * 100),
      },
      vehicular: {
        soldSerials,
        soldWithBin,
        soldWithoutBin,
        score: Math.round(vehicularScore * 100),
      },
    };
  }

  /** Regra vigente AGORA — mesmo critério do motor (findBestRule, #500) */
  private vigenteWhere(companyId: string, at: Date) {
    return {
      companyId,
      isActive: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
        { OR: [{ validTo: null }, { validTo: { gte: at } }] },
      ],
    };
  }
}

function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}
