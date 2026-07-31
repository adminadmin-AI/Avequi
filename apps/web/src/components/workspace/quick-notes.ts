/**
 * Notas rápidas — helpers PUROS (sem React) para spec em node.
 *
 * O widget é o único lugar do sistema onde o esqueumorfismo (papel + alfinete)
 * é HONESTO: são anotações que o PRÓPRIO usuário cria e arranca. Mesmo assim,
 * os tints de papel saem de tokens semânticos existentes (warning/brand/info/
 * success) em baixa opacidade — o post-it pertence ao sistema, não destoa.
 */

export const NOTE_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface NoteColorStyle {
  /** Fundo do papel. */
  paper: string;
  /** Sombra/borda inferior sutil para dar espessura. */
  edge: string;
}

/** Classe utilitária Tailwind por cor — fundo de papel + aresta. */
export const NOTE_STYLE: Record<NoteColor, NoteColorStyle> = {
  yellow: { paper: 'bg-warning/15 dark:bg-warning/20', edge: 'border-warning/25' },
  pink: { paper: 'bg-danger/10 dark:bg-danger/20', edge: 'border-danger/25' },
  blue: { paper: 'bg-info/12 dark:bg-info/20', edge: 'border-info/25' },
  green: { paper: 'bg-success/12 dark:bg-success/20', edge: 'border-success/25' },
  purple: { paper: 'bg-brand-500/12 dark:bg-brand-500/20', edge: 'border-brand-500/25' },
};

/** Cor válida ou o default amarelo — nunca estoura com valor do backend. */
export function safeColor(value: string | null | undefined): NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(value ?? '')
    ? (value as NoteColor)
    : 'yellow';
}

/**
 * Inclinação leve e ESTÁVEL por id — post-its retos demais parecem impressos;
 * tortos demais viram bagunça. Determinística (mesmo id → mesmo ângulo), então
 * a nota não "pula" a cada render. Faixa ~[-2.2°, +2.2°].
 */
export function tiltFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const normalized = (Math.abs(hash) % 1000) / 1000; // 0..1
  return Math.round((normalized * 4.4 - 2.2) * 10) / 10;
}
