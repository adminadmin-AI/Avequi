import type Anthropic from '@anthropic-ai/sdk';
import {
  CACHE_WRITE_MULTIPLIER,
  SDR_CACHE_TTL,
  addUsage,
  emptyUsage,
  estimateCostUsd,
  totalCacheWrite,
} from './sdr.types';

/** Usage mínimo da API; os specs só se importam com os campos de token. */
function usageFrom(partial: Partial<Anthropic.Messages.Usage>): Anthropic.Messages.Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation: null,
    ...partial,
  } as Anthropic.Messages.Usage;
}

describe('custo do SDR (#524) — escrita de cache por TTL', () => {
  describe('estimateCostUsd', () => {
    it('cobra a escrita de 1h a 2x e a de 5min a 1.25x do input', () => {
      // haiku: input 1, output 5 por 1M — mantém a conta legível
      const cost = estimateCostUsd('claude-haiku-4-5', {
        input: 1_000,
        output: 1_000,
        cacheRead: 1_000,
        cacheWrite5m: 1_000,
        cacheWrite1h: 1_000,
      });
      // 1000*1 + 1000*5 + 1000*0.1 + 1000*1.25 + 1000*2 = 9350
      expect(cost).toBeCloseTo(9_350 / 1_000_000, 10);
    });

    it('escrita de 1h custa mais que a mesma escrita em 5min', () => {
      const base = { input: 0, output: 0, cacheRead: 0 };
      const umaHora = estimateCostUsd('claude-opus-4-8', {
        ...base,
        cacheWrite5m: 0,
        cacheWrite1h: 10_000,
      });
      const cincoMin = estimateCostUsd('claude-opus-4-8', {
        ...base,
        cacheWrite5m: 10_000,
        cacheWrite1h: 0,
      });
      // regressão: se alguém reduzir 1h ao multiplicador de 5min, isso quebra
      expect(umaHora).toBeGreaterThan(cincoMin);
      expect(umaHora / cincoMin).toBeCloseTo(
        CACHE_WRITE_MULTIPLIER['1h'] / CACHE_WRITE_MULTIPLIER['5m'],
        10,
      );
    });

    it('modelo desconhecido cai no preço do opus (não zera o custo)', () => {
      const desconhecido = estimateCostUsd('claude-modelo-que-nao-existe', {
        ...emptyUsage(),
        output: 1_000,
      });
      const opus = estimateCostUsd('claude-opus-4-8', { ...emptyUsage(), output: 1_000 });
      expect(desconhecido).toBe(opus);
    });
  });

  describe('addUsage', () => {
    it('separa a escrita de cache usando a quebra da API', () => {
      const acc = emptyUsage();
      addUsage(
        acc,
        usageFrom({
          input_tokens: 120,
          output_tokens: 80,
          cache_read_input_tokens: 2_000,
          cache_creation_input_tokens: 900,
          cache_creation: {
            ephemeral_5m_input_tokens: 400,
            ephemeral_1h_input_tokens: 500,
          },
        }),
      );
      expect(acc.cacheWrite5m).toBe(400);
      expect(acc.cacheWrite1h).toBe(500);
      expect(totalCacheWrite(acc)).toBe(900);
    });

    it('sem a quebra, atribui o total ao TTL configurado', () => {
      const acc = emptyUsage();
      addUsage(acc, usageFrom({ cache_creation_input_tokens: 700, cache_creation: null }));
      const esperado = SDR_CACHE_TTL === '1h' ? acc.cacheWrite1h : acc.cacheWrite5m;
      expect(esperado).toBe(700);
      expect(totalCacheWrite(acc)).toBe(700);
    });

    it('acumula ao longo das iterações de tool', () => {
      const acc = emptyUsage();
      const turno = usageFrom({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 200 },
      });
      addUsage(acc, turno);
      addUsage(acc, turno);
      expect(acc.input).toBe(200);
      expect(acc.output).toBe(100);
      expect(acc.cacheRead).toBe(2_000);
      expect(acc.cacheWrite1h).toBe(400);
    });
  });
});
