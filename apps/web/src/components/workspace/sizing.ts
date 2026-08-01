import type { WidgetSize } from './types';

/**
 * Tiers de tamanho do Workspace — módulo PURO (sem React), testável em node.
 *
 * Três presets, nunca resize livre por pixel: P (um terço), M (metade) e
 * G (largura toda). O grid tem 12 colunas para os três serem frações exatas
 * dele: P+P+P e M+M fecham a linha; G ocupa tudo.
 *
 * Misturar P e M numa mesma linha deixa sobra (4+6 = 10 de 12) — isso é
 * inerente a oferecer terço E metade, e `grid-flow-dense` reaproveita a
 * sobra com o próximo widget que couber. O que restar na ÚLTIMA linha só
 * vira convite se couber um widget de verdade (ver MIN_INVITE_SPAN).
 *
 * COMPATIBILIDADE: até a F2 existiam só dois presets, `half` e `full`, e há
 * layouts salvos no banco com esses valores. `normalizeSize` traduz o legado
 * na LEITURA (half → M, full → G); a escrita já usa o vocabulário novo. Sem
 * migração de dados: o valor antigo continua válido para sempre.
 */

export const GRID_COLUMNS = 12;

export const SIZE_SPAN: Record<WidgetSize, number> = {
  small: 4,
  medium: 6,
  large: 12,
};

/** Rótulo curto do seletor no modo edição. */
export const SIZE_LABEL: Record<WidgetSize, string> = {
  small: 'P',
  medium: 'M',
  large: 'G',
};

export const SIZE_TITLE: Record<WidgetSize, string> = {
  small: 'Pequeno (um terço)',
  medium: 'Médio (metade)',
  large: 'Grande (largura toda)',
};

/** Ordem canônica — o seletor sempre mostra P → M → G. */
export const SIZE_ORDER: readonly WidgetSize[] = ['small', 'medium', 'large'] as const;

const LEGACY: Record<string, WidgetSize> = {
  half: 'medium',
  full: 'large',
};

/**
 * Aceita o vocabulário novo e o legado; devolve undefined para qualquer
 * outra coisa (layout corrompido ou de uma versão futura não derruba a Home).
 */
export function normalizeSize(value: unknown): WidgetSize | undefined {
  if (typeof value !== 'string') return undefined;
  if (value in SIZE_SPAN) return value as WidgetSize;
  return LEGACY[value];
}

export function spanOf(size: WidgetSize): number {
  return SIZE_SPAN[size];
}

/** Abaixo disto o vão é fino demais para um botão — vira respiro, não convite. */
export const MIN_INVITE_SPAN = SIZE_SPAN.small;

/**
 * Colunas livres na última linha do grid — o vão que sobra vira o convite
 * "+ Adicionar widget" quando comporta um widget. 0 = a última linha fechou.
 *
 * É uma aproximação deliberada: com `grid-flow-dense` o navegador pode
 * empacotar diferente da ordem, mas a SOBRA total da última linha é a
 * mesma — e é só ela que o convite precisa preencher.
 */
export function trailingGap(sizes: WidgetSize[]): number {
  const used = sizes.reduce((sum, s) => sum + spanOf(s), 0) % GRID_COLUMNS;
  return used === 0 ? 0 : GRID_COLUMNS - used;
}
