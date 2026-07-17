import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * #755 — Motor de diferença IBS/CBS para Notas de Débito/Crédito da Reforma
 * (finNFe 5/6, Ajuste SINIEF 49/2025).
 *
 * Princípio (mesmo da devolução #747): o ajuste ESPELHA a NF-e original — as
 * alíquotas efetivas são DERIVADAS dos valores persistidos (valor/base), o que
 * captura gRed/reduções implicitamente e não depende da TaxRule vigente na
 * data do ajuste (vigência #500 poderia divergir da original).
 *
 * Notas 5/6 só podem conter IBS/CBS (regra SEFAZ da Reforma) — o motor não
 * produz delta de ICMS/IPI/PIS/COFINS.
 *
 * Modos:
 * - FULL: estorno integral (crédito) — delta = base cheia de cada item.
 * - ITEMS: delta de base informado por item (id do FiscalDocumentItem).
 * - TOTAL: delta total rateado proporcionalmente às bases originais (resto de
 *   arredondamento no último item, para o total fechar exato).
 * - AMOUNT: valor avulso (débito de multa/juros etc.) — vira UM item sintético
 *   com as alíquotas da original; exige alíquotas homogêneas entre os itens
 *   (heterogêneo → erro orientado pedindo ITEMS).
 */

export interface AdjustmentSourceTax {
  cClassTrib: string | null;
  cstCbs: string | null;
  baseCbs: number;
  valorCbs: number;
  baseIbsUf: number;
  valorIbsUf: number;
  baseIbsMun: number;
  valorIbsMun: number;
}

export interface AdjustmentSourceItem {
  id: string;
  sku: string;
  name: string;
  ncm: string | null;
  tax: AdjustmentSourceTax;
}

export type AdjustmentSpec =
  | { mode: 'FULL' }
  | { mode: 'ITEMS'; itemDeltas: Array<{ fiscalDocumentItemId: string; baseDelta: number }> }
  | { mode: 'TOTAL'; totalDelta: number }
  | { mode: 'AMOUNT'; amount: number; description?: string };

export interface AdjustmentItem {
  sourceItemId: string | null; // null = item sintético (AMOUNT)
  sku: string;
  name: string;
  ncm: string | null;
  base: number;
  cClassTrib: string;
  cstCbs: string;
  cbsAliquota: number; // alíquota EFETIVA derivada (valor/base da original), 4 casas
  cbsValor: number;
  ibsUfAliquota: number;
  ibsUfValor: number;
  ibsMunAliquota: number;
  ibsMunValor: number;
}

export interface AdjustmentResult {
  items: AdjustmentItem[];
  totalBase: number;
  vCBS: number;
  vIBS: number; // UF + Mun
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** Alíquota efetiva derivada dos valores persistidos (% com 4 casas) */
const effectiveRate = (valor: number, base: number): number =>
  base > 0 ? round4((valor / base) * 100) : 0;

@Injectable()
export class IbsCbsAdjustmentService {
  /**
   * Calcula os itens da nota de ajuste a partir dos itens/impostos persistidos
   * da NF-e original. Lança BadRequest orientado quando o spec não fecha com a
   * original (item inexistente, delta acima da base, alíquotas heterogêneas).
   */
  compute(source: AdjustmentSourceItem[], spec: AdjustmentSpec): AdjustmentResult {
    const eligible = source.filter((s) => s.tax.cClassTrib);
    if (eligible.length === 0) {
      throw new BadRequestException(
        'NF-e original sem grupo IBS/CBS persistido — nota de débito/crédito só ajusta IBS/CBS (docs pré-Reforma não são ajustáveis por este fluxo).',
      );
    }

    switch (spec.mode) {
      case 'FULL':
        return this.build(eligible.map((s) => ({ src: s, baseDelta: s.tax.baseCbs })));

      case 'ITEMS': {
        if (!spec.itemDeltas?.length) {
          throw new BadRequestException('Modo ITEMS exige itemDeltas com pelo menos um item.');
        }
        const pairs = spec.itemDeltas.map((d) => {
          const src = eligible.find((s) => s.id === d.fiscalDocumentItemId);
          if (!src) {
            throw new BadRequestException(
              `Item ${d.fiscalDocumentItemId} não existe na NF-e original (ou não tem IBS/CBS).`,
            );
          }
          if (!(d.baseDelta > 0)) {
            throw new BadRequestException(`baseDelta do item ${src.sku} deve ser > 0.`);
          }
          if (d.baseDelta > src.tax.baseCbs + 0.005) {
            throw new BadRequestException(
              `baseDelta do item ${src.sku} (${d.baseDelta.toFixed(2)}) excede a base original (${src.tax.baseCbs.toFixed(2)}).`,
            );
          }
          return { src, baseDelta: round2(d.baseDelta) };
        });
        return this.build(pairs);
      }

      case 'TOTAL': {
        const totalBase = round2(eligible.reduce((s, i) => s + i.tax.baseCbs, 0));
        if (!(spec.totalDelta > 0)) throw new BadRequestException('totalDelta deve ser > 0.');
        if (spec.totalDelta > totalBase + 0.005) {
          throw new BadRequestException(
            `totalDelta (${spec.totalDelta.toFixed(2)}) excede a base total da NF-e original (${totalBase.toFixed(2)}).`,
          );
        }
        // rateio proporcional; resto de arredondamento no último item
        const pairs = eligible.map((src) => ({
          src,
          baseDelta: round2((spec.totalDelta * src.tax.baseCbs) / totalBase),
        }));
        const allocated = round2(pairs.reduce((s, p) => s + p.baseDelta, 0));
        const remainder = round2(spec.totalDelta - allocated);
        if (remainder !== 0) {
          pairs[pairs.length - 1].baseDelta = round2(pairs[pairs.length - 1].baseDelta + remainder);
        }
        return this.build(pairs);
      }

      case 'AMOUNT': {
        if (!(spec.amount > 0)) throw new BadRequestException('amount deve ser > 0.');
        const first = eligible[0];
        const rates = (s: AdjustmentSourceItem) => ({
          cbs: effectiveRate(s.tax.valorCbs, s.tax.baseCbs),
          uf: effectiveRate(s.tax.valorIbsUf, s.tax.baseIbsUf),
          mun: effectiveRate(s.tax.valorIbsMun, s.tax.baseIbsMun),
          cClassTrib: s.tax.cClassTrib,
        });
        const ref = rates(first);
        const heterogeneous = eligible.some((s) => {
          const r = rates(s);
          return (
            r.cClassTrib !== ref.cClassTrib ||
            Math.abs(r.cbs - ref.cbs) > 0.0001 ||
            Math.abs(r.uf - ref.uf) > 0.0001 ||
            Math.abs(r.mun - ref.mun) > 0.0001
          );
        });
        if (heterogeneous) {
          throw new BadRequestException(
            'A NF-e original tem alíquotas/classificações IBS/CBS heterogêneas entre os itens — use o modo ITEMS (delta por item) em vez de um valor avulso.',
          );
        }
        // item sintético espelhando as alíquotas da original
        const synthetic: AdjustmentSourceItem = {
          id: first.id,
          sku: 'AJUSTE',
          name: (spec.description ?? 'AJUSTE IBS/CBS').toUpperCase().slice(0, 120),
          ncm: first.ncm,
          tax: first.tax,
        };
        const result = this.build([{ src: synthetic, baseDelta: round2(spec.amount) }]);
        result.items[0].sourceItemId = null;
        return result;
      }
    }
  }

  private build(pairs: Array<{ src: AdjustmentSourceItem; baseDelta: number }>): AdjustmentResult {
    const items: AdjustmentItem[] = pairs.map(({ src, baseDelta }) => {
      const cbsAliquota = effectiveRate(src.tax.valorCbs, src.tax.baseCbs);
      const ibsUfAliquota = effectiveRate(src.tax.valorIbsUf, src.tax.baseIbsUf);
      const ibsMunAliquota = effectiveRate(src.tax.valorIbsMun, src.tax.baseIbsMun);
      return {
        sourceItemId: src.id,
        sku: src.sku,
        name: src.name,
        ncm: src.ncm,
        base: baseDelta,
        cClassTrib: src.tax.cClassTrib!,
        cstCbs: src.tax.cstCbs ?? '000',
        cbsAliquota,
        cbsValor: round2((baseDelta * cbsAliquota) / 100),
        ibsUfAliquota,
        ibsUfValor: round2((baseDelta * ibsUfAliquota) / 100),
        ibsMunAliquota,
        ibsMunValor: round2((baseDelta * ibsMunAliquota) / 100),
      };
    });

    return {
      items,
      totalBase: round2(items.reduce((s, i) => s + i.base, 0)),
      vCBS: round2(items.reduce((s, i) => s + i.cbsValor, 0)),
      vIBS: round2(items.reduce((s, i) => s + i.ibsUfValor + i.ibsMunValor, 0)),
    };
  }
}
