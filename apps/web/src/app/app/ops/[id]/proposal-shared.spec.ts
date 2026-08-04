import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_STATUS_LABEL,
  PROPOSAL_STATUS_VARIANT,
  acoesDaProposta,
  ehDecidida,
  ehNegociado,
  estaVencida,
  statusExibido,
  validadeParaISO,
} from './proposal-shared';

const AGORA = new Date('2026-08-04T12:00:00Z');

describe('ehNegociado', () => {
  it('marca negociado quando o valor difere da tabela do plano', () => {
    expect(ehNegociado({ priceCents: 89000, plan: { priceCents: 99000 } })).toBe(true);
  });

  it('não marca quando o valor é o da tabela', () => {
    expect(ehNegociado({ priceCents: 99000, plan: { priceCents: 99000 } })).toBe(false);
  });

  it('não marca quando o plano não tem preço de tabela (nada a comparar)', () => {
    expect(ehNegociado({ priceCents: 99000, plan: { priceCents: null } })).toBe(false);
    expect(ehNegociado({ priceCents: 99000 })).toBe(false);
  });
});

describe('estaVencida', () => {
  it('proposta sem validade nunca vence', () => {
    expect(estaVencida({ validUntil: null }, AGORA)).toBe(false);
  });

  it('vence quando a validade já passou', () => {
    expect(estaVencida({ validUntil: '2026-08-03T23:59:59.000Z' }, AGORA)).toBe(true);
  });

  it('não vence dentro do prazo', () => {
    expect(estaVencida({ validUntil: '2026-08-10T23:59:59.000Z' }, AGORA)).toBe(false);
  });
});

describe('statusExibido', () => {
  it('mostra vencida a proposta aberta fora da validade (backend só carimba no toque)', () => {
    expect(statusExibido({ status: 'SENT', validUntil: '2026-08-01T00:00:00.000Z' }, AGORA)).toBe(
      'EXPIRED',
    );
    expect(statusExibido({ status: 'DRAFT', validUntil: '2026-08-01T00:00:00.000Z' }, AGORA)).toBe(
      'EXPIRED',
    );
  });

  it('não reescreve o status de proposta já decidida', () => {
    expect(
      statusExibido({ status: 'ACCEPTED', validUntil: '2026-08-01T00:00:00.000Z' }, AGORA),
    ).toBe('ACCEPTED');
    expect(
      statusExibido({ status: 'DECLINED', validUntil: '2026-08-01T00:00:00.000Z' }, AGORA),
    ).toBe('DECLINED');
  });

  it('mantém o status dentro do prazo', () => {
    expect(statusExibido({ status: 'SENT', validUntil: null }, AGORA)).toBe('SENT');
  });
});

describe('ehDecidida', () => {
  it('aceita e recusada são imutáveis', () => {
    expect(ehDecidida({ status: 'ACCEPTED' })).toBe(true);
    expect(ehDecidida({ status: 'DECLINED' })).toBe(true);
    expect(ehDecidida({ status: 'DRAFT' })).toBe(false);
    expect(ehDecidida({ status: 'SENT' })).toBe(false);
    expect(ehDecidida({ status: 'EXPIRED' })).toBe(false);
  });
});

describe('acoesDaProposta', () => {
  it('rascunho pode ser enviado e decidido', () => {
    expect(acoesDaProposta({ status: 'DRAFT', validUntil: null }, AGORA)).toEqual({
      podeEnviar: true,
      podeDecidir: true,
    });
  });

  it('enviada só pode ser decidida', () => {
    expect(acoesDaProposta({ status: 'SENT', validUntil: null }, AGORA)).toEqual({
      podeEnviar: false,
      podeDecidir: true,
    });
  });

  it('decidida não oferece ação', () => {
    expect(acoesDaProposta({ status: 'ACCEPTED', validUntil: null }, AGORA)).toEqual({
      podeEnviar: false,
      podeDecidir: false,
    });
  });

  it('aberta mas vencida não oferece ação (a API recusaria)', () => {
    expect(
      acoesDaProposta({ status: 'SENT', validUntil: '2026-08-01T00:00:00.000Z' }, AGORA),
    ).toEqual({ podeEnviar: false, podeDecidir: false });
  });
});

describe('validadeParaISO', () => {
  it('vazio vira undefined (validade é opcional)', () => {
    expect(validadeParaISO('')).toBeUndefined();
  });

  it('usa o FIM do dia local — a proposta não pode vencer um dia antes', () => {
    const iso = validadeParaISO('2026-08-10');
    expect(iso).toBeDefined();
    const d = new Date(iso as string);
    // Mesmo dia no fuso local de quem preencheu, às 23:59:59.
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(10);
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });

  it('data inválida não vira ISO quebrado', () => {
    expect(validadeParaISO('não-é-data')).toBeUndefined();
  });
});

describe('labels e variantes', () => {
  it('cobrem todos os status do enum', () => {
    const status = ['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
    for (const s of status) {
      expect(PROPOSAL_STATUS_LABEL[s]).toBeTruthy();
      expect(PROPOSAL_STATUS_VARIANT[s]).toBeTruthy();
    }
  });
});
