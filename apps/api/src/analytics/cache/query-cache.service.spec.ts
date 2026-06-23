import { Test, TestingModule } from '@nestjs/testing';
import { QueryCacheService } from './query-cache.service';

describe('QueryCacheService', () => {
  let service: QueryCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QueryCacheService],
    }).compile();

    service = module.get<QueryCacheService>(QueryCacheService);
    service.clear();
  });

  // ─── get / set ─────────────────────────────────────────────────────────────

  describe('set() / get()', () => {
    it('stores and retrieves a value', () => {
      service.set('key1', { data: 42 }, 60);
      expect(service.get('key1')).toEqual({ data: 42 });
    });

    it('returns undefined for nonexistent key', () => {
      expect(service.get('nonexistent')).toBeUndefined();
    });

    it('returns undefined for expired key', async () => {
      service.set('expired', 'value', 0); // 0 seconds TTL

      // Wait a tick to ensure expiry
      await new Promise((r) => setTimeout(r, 10));

      expect(service.get('expired')).toBeUndefined();
    });

    it('does not return expired entry', () => {
      // Set with negative TTL (already expired)
      service.set('past', 'old', -1);
      expect(service.get('past')).toBeUndefined();
    });

    it('overwrites existing key', () => {
      service.set('key', 'first', 60);
      service.set('key', 'second', 60);
      expect(service.get('key')).toBe('second');
    });

    it('supports different value types', () => {
      service.set('str', 'hello', 60);
      service.set('num', 42, 60);
      service.set('arr', [1, 2, 3], 60);
      service.set('obj', { x: 1 }, 60);

      expect(service.get('str')).toBe('hello');
      expect(service.get('num')).toBe(42);
      expect(service.get<number[]>('arr')).toEqual([1, 2, 3]);
      expect(service.get('obj')).toEqual({ x: 1 });
    });
  });

  // ─── invalidate ────────────────────────────────────────────────────────────

  describe('invalidate()', () => {
    it('removes a specific key', () => {
      service.set('myKey', 'value', 60);
      service.invalidate('myKey');
      expect(service.get('myKey')).toBeUndefined();
    });

    it('does not throw when key does not exist', () => {
      expect(() => service.invalidate('ghost')).not.toThrow();
    });

    it('only removes the specified key', () => {
      service.set('key1', 'a', 60);
      service.set('key2', 'b', 60);
      service.invalidate('key1');
      expect(service.get('key1')).toBeUndefined();
      expect(service.get('key2')).toBe('b');
    });
  });

  // ─── invalidateByPrefix ────────────────────────────────────────────────────

  describe('invalidateByPrefix()', () => {
    it('removes all keys with the given prefix', () => {
      service.set('company-1:sales:q1', 'data1', 60);
      service.set('company-1:sales:q2', 'data2', 60);
      service.set('company-2:sales:q1', 'data3', 60);

      service.invalidateByPrefix('company-1:');

      expect(service.get('company-1:sales:q1')).toBeUndefined();
      expect(service.get('company-1:sales:q2')).toBeUndefined();
      expect(service.get('company-2:sales:q1')).toBe('data3');
    });

    it('does not throw when no keys match', () => {
      expect(() => service.invalidateByPrefix('nonexistent:')).not.toThrow();
    });
  });

  // ─── getCacheKey ───────────────────────────────────────────────────────────

  describe('getCacheKey()', () => {
    it('generates deterministic key', () => {
      const key1 = service.getCacheKey('c1', '/sales', { from: '2026-01', to: '2026-06' });
      const key2 = service.getCacheKey('c1', '/sales', { to: '2026-06', from: '2026-01' });
      expect(key1).toBe(key2);
    });

    it('generates different key for different params', () => {
      const key1 = service.getCacheKey('c1', '/sales', { from: '2026-01' });
      const key2 = service.getCacheKey('c1', '/sales', { from: '2026-02' });
      expect(key1).not.toBe(key2);
    });

    it('generates different key for different companies', () => {
      const key1 = service.getCacheKey('company-1', '/sales', {});
      const key2 = service.getCacheKey('company-2', '/sales', {});
      expect(key1).not.toBe(key2);
    });

    it('handles undefined params', () => {
      const key = service.getCacheKey('c1', '/sales');
      expect(key).toBeTruthy();
      expect(key).toContain('c1');
      expect(key).toContain('/sales');
    });
  });

  // ─── wrap ──────────────────────────────────────────────────────────────────

  describe('wrap()', () => {
    it('calls fn and caches result on first call', async () => {
      const fn = jest.fn().mockResolvedValue({ data: 'result' });
      const result = await service.wrap('wrap-key', 60, fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: 'result' });
    });

    it('returns cached value without calling fn on second call', async () => {
      const fn = jest.fn().mockResolvedValue({ data: 'result' });

      await service.wrap('wrap-key-2', 60, fn);
      await service.wrap('wrap-key-2', 60, fn);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls fn again after cache expiry', async () => {
      const fn = jest.fn().mockResolvedValue({ data: 'fresh' });

      service.set('wrap-key-3', { data: 'old' }, -1); // already expired

      const result = await service.wrap('wrap-key-3', 60, fn);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: 'fresh' });
    });

    it('propagates fn errors', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('fn failed'));

      await expect(service.wrap('wrap-err', 60, fn)).rejects.toThrow('fn failed');
    });
  });

  // ─── getStats ──────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns zero stats on empty cache', () => {
      const stats = service.getStats();
      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('tracks hits and misses', () => {
      service.set('k1', 'v', 60);
      service.get('k1'); // hit
      service.get('missing'); // miss

      const stats = service.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(0.5);
    });

    it('counts cached entries', () => {
      service.set('a', 1, 60);
      service.set('b', 2, 60);
      service.set('c', 3, 60);

      const stats = service.getStats();
      expect(stats.size).toBe(3);
    });

    it('evicts expired entries from count', async () => {
      service.set('valid', 'x', 60);
      service.set('expired', 'y', -1);

      const stats = service.getStats();
      expect(stats.size).toBe(1);
    });

    it('hitRate is 1 when all hits', () => {
      service.set('k', 'v', 60);
      service.get('k');
      service.get('k');

      const stats = service.getStats();
      expect(stats.hitRate).toBe(1);
    });
  });
});
