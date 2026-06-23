import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_SLOW_THRESHOLD_MS = 1000;

@Injectable()
export class QueryAuditService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Log ─────────────────────────────────────────────────────────────────────

  async log(
    companyId: string,
    userId: string,
    endpoint: string,
    params: Record<string, unknown> | null,
    duration: number,
    cached: boolean,
  ) {
    return this.prisma.analyticsQueryLog.create({
      data: {
        companyId,
        userId,
        endpoint,
        params: params ?? undefined,
        duration,
        cached,
      },
    });
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  async getQueryStats(
    companyId: string,
    startDate?: Date,
    endDate?: Date,
  ) {
    const where = {
      companyId,
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: startDate }),
              ...(endDate && { lte: endDate }),
            },
          }
        : {}),
    };

    const logs = await this.prisma.analyticsQueryLog.findMany({
      where,
      select: {
        endpoint: true,
        duration: true,
        cached: true,
      },
    });

    if (logs.length === 0) {
      return {
        totalQueries: 0,
        avgDurationMs: 0,
        cacheHitRate: 0,
        topEndpoints: [],
      };
    }

    // Aggregate by endpoint
    const endpointMap = new Map<string, { count: number; totalDuration: number }>();
    let totalDuration = 0;
    let cachedCount = 0;

    for (const log of logs) {
      totalDuration += log.duration;
      if (log.cached) cachedCount++;

      const existing = endpointMap.get(log.endpoint);
      if (existing) {
        existing.count++;
        existing.totalDuration += log.duration;
      } else {
        endpointMap.set(log.endpoint, { count: 1, totalDuration: log.duration });
      }
    }

    const topEndpoints = Array.from(endpointMap.entries())
      .map(([endpoint, stats]) => ({
        endpoint,
        count: stats.count,
        avgDurationMs: Math.round(stats.totalDuration / stats.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalQueries: logs.length,
      avgDurationMs: Math.round(totalDuration / logs.length),
      cacheHitRate: cachedCount / logs.length,
      topEndpoints,
    };
  }

  // ─── Slow Queries ─────────────────────────────────────────────────────────────

  async getSlowQueries(
    companyId: string,
    thresholdMs: number = DEFAULT_SLOW_THRESHOLD_MS,
    startDate?: Date,
    endDate?: Date,
  ) {
    const where = {
      companyId,
      duration: { gte: thresholdMs },
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: startDate }),
              ...(endDate && { lte: endDate }),
            },
          }
        : {}),
    };

    return this.prisma.analyticsQueryLog.findMany({
      where,
      orderBy: { duration: 'desc' },
      take: 50,
    });
  }
}
