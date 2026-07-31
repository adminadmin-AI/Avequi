import { describe, expect, it } from 'vitest';
import { overallStatus, sortBySeverity } from './insights-status';

/** Status geral da Antonella — o pior insight dita o tom do widget. */

describe('overallStatus', () => {
  it('qualquer CRITICAL vence tudo', () => {
    expect(overallStatus(['SUCCESS', 'WARNING', 'CRITICAL', 'INFO'])).toBe('critical');
  });

  it('WARNING sem CRITICAL → attention', () => {
    expect(overallStatus(['INFO', 'WARNING', 'SUCCESS'])).toBe('attention');
  });

  it('INFO e SUCCESS não alarmam', () => {
    expect(overallStatus(['INFO', 'SUCCESS'])).toBe('ok');
  });

  it('sem insights → ok', () => {
    expect(overallStatus([])).toBe('ok');
  });
});

describe('sortBySeverity', () => {
  it('ordena do mais grave para o mais leve preservando empates', () => {
    const sorted = sortBySeverity([
      { id: 'a', severity: 'INFO' },
      { id: 'b', severity: 'CRITICAL' },
      { id: 'c', severity: 'SUCCESS' },
      { id: 'd', severity: 'CRITICAL' },
      { id: 'e', severity: 'WARNING' },
    ] as const);
    expect(sorted.map((s) => s.id)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });

  it('não muta o array original', () => {
    const original = [
      { severity: 'INFO' as const },
      { severity: 'CRITICAL' as const },
    ];
    sortBySeverity(original);
    expect(original[0].severity).toBe('INFO');
  });
});
