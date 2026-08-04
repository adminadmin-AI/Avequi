import { describe, expect, it } from 'vitest';
import type { BillingAging } from '@/types/api';
import {
  agingTone,
  inadimplenciaCents,
  periodLongLabel,
  periodShortLabel,
  temFaturamento,
  ticketMedioCents,
} from './panel-format';

const aging = (over: Partial<BillingAging> = {}): BillingAging => ({
  current: 0,
  d1_15: 0,
  d16_30: 0,
  d31_plus: 0,
  ...over,
});

describe('inadimplenciaCents (#957)', () => {
  it('soma só as faixas vencidas — "a vencer" não é inadimplência', () => {
    expect(inadimplenciaCents(aging({ current: 999_00, d1_15: 100, d16_30: 20, d31_plus: 3 }))).toBe(
      123,
    );
  });

  it('carteira em dia → zero', () => {
    expect(inadimplenciaCents(aging({ current: 500_00 }))).toBe(0);
  });
});

describe('agingTone (#957)', () => {
  it('nada vencido → verde (mesmo com muito a vencer)', () => {
    expect(agingTone(aging({ current: 1_000_00 }))).toBe('success');
  });

  it('atraso até 30 dias → warning', () => {
    expect(agingTone(aging({ d1_15: 1 }))).toBe('warning');
    expect(agingTone(aging({ d16_30: 1 }))).toBe('warning');
  });

  it('a faixa MAIS VELHA manda: 31+ vence as demais', () => {
    expect(agingTone(aging({ d1_15: 900_00, d31_plus: 1 }))).toBe('danger');
  });
});

describe('ticketMedioCents (#957 — número inventado não existe)', () => {
  it('sem assinatura ativa → null (não vira R$ 0,00)', () => {
    expect(ticketMedioCents(0, 0)).toBeNull();
    // MRR sem assinatura ativa é dado inconsistente — ainda assim, sem base
    expect(ticketMedioCents(500_00, 0)).toBeNull();
    expect(ticketMedioCents(500_00, -1)).toBeNull();
  });

  it('divide o MRR pelas assinaturas ativas, arredondando ao centavo', () => {
    expect(ticketMedioCents(300_00, 3)).toBe(100_00);
    expect(ticketMedioCents(100, 3)).toBe(33);
  });
});

describe('periodShortLabel / periodLongLabel (#957)', () => {
  it('YYYY-MM vira mês curto pt-BR no eixo e MM/AAAA no tooltip', () => {
    expect(periodShortLabel('2026-08')).toBe('ago/26');
    expect(periodShortLabel('2026-01')).toBe('jan/26');
    expect(periodShortLabel('2025-12')).toBe('dez/25');
    expect(periodLongLabel('2026-08')).toBe('08/2026');
  });

  it('entrada fora do formato volta crua — o painel não inventa mês', () => {
    expect(periodShortLabel('2026-13')).toBe('2026-13');
    expect(periodShortLabel('2026-00')).toBe('2026-00');
    expect(periodShortLabel('agosto')).toBe('agosto');
    expect(periodLongLabel('agosto')).toBe('agosto');
  });
});

describe('temFaturamento (#957)', () => {
  it('série toda zerada não é gráfico — é ausência de faturamento', () => {
    expect(
      temFaturamento([
        { period: '2026-07', amountCents: 0 },
        { period: '2026-08', amountCents: 0 },
      ]),
    ).toBe(false);
    expect(temFaturamento([])).toBe(false);
    expect(temFaturamento(undefined)).toBe(false);
  });

  it('uma competência com valor já basta para desenhar', () => {
    expect(
      temFaturamento([
        { period: '2026-07', amountCents: 0 },
        { period: '2026-08', amountCents: 1 },
      ]),
    ).toBe(true);
  });
});
