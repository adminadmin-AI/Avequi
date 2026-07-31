import { describe, expect, it } from 'vitest';
import { summarizeAgenda } from './agenda-summary';

/** Sumário compacto da agenda — a linha-resumo por tipo do estado colapsado. */

const TODAY = '2026-07-30';

describe('summarizeAgenda', () => {
  it('agrega por tipo na ordem fixa financeiro → produção → CRM', () => {
    const summary = summarizeAgenda(
      [
        { kind: 'crm-reminder', date: '2026-07-31' },
        { kind: 'finance-due', date: TODAY, tone: 'danger' },
        { kind: 'finance-due', date: '2026-08-01' },
        { kind: 'production-end', date: TODAY },
      ],
      TODAY,
    );
    expect(summary.map((s) => s.kind)).toEqual(['finance-due', 'production-end', 'crm-reminder']);
  });

  it('conta total, recorte de hoje e alarme por tipo', () => {
    const summary = summarizeAgenda(
      [
        { kind: 'finance-due', date: TODAY, tone: 'danger' },
        { kind: 'finance-due', date: '2026-08-01', tone: 'neutral' },
        { kind: 'finance-due', date: '2026-08-02' },
      ],
      TODAY,
    );
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ total: 3, today: 1, hasDanger: true });
    expect(summary[0].label).toBe('3 vencimentos financeiros');
  });

  it('singular no label quando só há um item do tipo', () => {
    const summary = summarizeAgenda([{ kind: 'crm-reminder', date: TODAY }], TODAY);
    expect(summary[0].label).toBe('1 lembrete de CRM');
  });

  it('tipo sem itens não gera linha', () => {
    expect(summarizeAgenda([], TODAY)).toEqual([]);
  });
});
