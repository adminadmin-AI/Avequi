import { ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  AdaptiveThrottlerGuard,
  GLOBAL_RATE_LIMIT,
  trustedMultiplier,
} from './adaptive-throttler.guard';

/**
 * #349 — rate limiting adaptativo. Testa as DUAS decisões do guard
 * (tracker por usuário; teto global ampliado só p/ autenticado) isolando o
 * ThrottlerGuard base via spy — o storage/contagem é do framework.
 */
describe('AdaptiveThrottlerGuard (#349)', () => {
  const guard = Object.create(AdaptiveThrottlerGuard.prototype) as AdaptiveThrottlerGuard;

  function contextFor(req: Record<string, any>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.RATE_LIMIT_TRUSTED_MULTIPLIER;
  });

  describe('getTracker', () => {
    it('autenticado → conta por user:{id} (não por IP)', async () => {
      await expect(
        (guard as any).getTracker({ user: { id: 'u-1' }, ip: '10.0.0.1' }),
      ).resolves.toBe('user:u-1');
    });

    it('anônimo → conta por IP (primeiro do X-Forwarded-For quando presente)', async () => {
      await expect((guard as any).getTracker({ ip: '10.0.0.1' })).resolves.toBe('10.0.0.1');
      await expect(
        (guard as any).getTracker({ ips: ['200.1.2.3', '10.0.0.1'], ip: '10.0.0.1' }),
      ).resolves.toBe('200.1.2.3');
    });
  });

  describe('handleRequest — limite adaptativo', () => {
    function spyBase() {
      return jest
        .spyOn(ThrottlerGuard.prototype as any, 'handleRequest')
        .mockResolvedValue(true);
    }

    it('autenticado no teto GLOBAL → limite multiplicado (default 2×)', async () => {
      const base = spyBase();
      await (guard as any).handleRequest({
        context: contextFor({ user: { id: 'u-1' } }),
        limit: GLOBAL_RATE_LIMIT,
        ttl: 60000,
      });
      expect(base).toHaveBeenCalledWith(
        expect.objectContaining({ limit: GLOBAL_RATE_LIMIT * 2 }),
      );
    });

    it('anônimo → limite global INTACTO', async () => {
      const base = spyBase();
      await (guard as any).handleRequest({
        context: contextFor({ ip: '1.2.3.4' }),
        limit: GLOBAL_RATE_LIMIT,
        ttl: 60000,
      });
      expect(base).toHaveBeenCalledWith(expect.objectContaining({ limit: GLOBAL_RATE_LIMIT }));
    });

    it('limite ESTRITO de rota (login 5/min, export 10/min) NUNCA infla, nem autenticado', async () => {
      const base = spyBase();
      for (const strict of [5, 10]) {
        await (guard as any).handleRequest({
          context: contextFor({ user: { id: 'u-1' } }),
          limit: strict,
          ttl: 60000,
        });
        expect(base).toHaveBeenLastCalledWith(expect.objectContaining({ limit: strict }));
      }
    });

    it('multiplicador configurável por env (RATE_LIMIT_TRUSTED_MULTIPLIER)', async () => {
      process.env.RATE_LIMIT_TRUSTED_MULTIPLIER = '3';
      expect(trustedMultiplier()).toBe(3);
      const base = spyBase();
      await (guard as any).handleRequest({
        context: contextFor({ user: { id: 'u-1' } }),
        limit: GLOBAL_RATE_LIMIT,
        ttl: 60000,
      });
      expect(base).toHaveBeenCalledWith(
        expect.objectContaining({ limit: GLOBAL_RATE_LIMIT * 3 }),
      );
    });

    it('multiplicador inválido ou < 1 → fallback 2 (nunca REDUZ limite)', () => {
      process.env.RATE_LIMIT_TRUSTED_MULTIPLIER = '0.5';
      expect(trustedMultiplier()).toBe(2);
      process.env.RATE_LIMIT_TRUSTED_MULTIPLIER = 'banana';
      expect(trustedMultiplier()).toBe(2);
    });
  });
});
