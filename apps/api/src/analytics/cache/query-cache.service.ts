import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

@Injectable()
export class QueryCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;

  // ─── Core ─────────────────────────────────────────────────────────────────────

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  // ─── Key Generation ───────────────────────────────────────────────────────────

  getCacheKey(
    companyId: string,
    endpoint: string,
    params?: Record<string, unknown>,
  ): string {
    const sortedParams = params
      ? JSON.stringify(
          Object.keys(params)
            .sort()
            .reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = params[k];
              return acc;
            }, {}),
        )
      : '';
    return `${companyId}:${endpoint}:${sortedParams}`;
  }

  // ─── Cache-aside Pattern ──────────────────────────────────────────────────────

  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await fn();
    this.set(key, result, ttlSeconds);
    return result;
  }

  // ─── Stats ────────────────────────────────────────────────────────────────────

  getStats(): CacheStats {
    // Evict expired entries before counting
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
      }
    }

    const total = this.hits + this.misses;
    return {
      size: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ─── Test Helper ─────────────────────────────────────────────────────────────

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
