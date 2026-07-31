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

/**
 * Paleta de papel "grife" (mockup aprovado 31/07): papel com gradiente
 * topo→base, texto escuro legível SOBRE o papel (mesmo no dark mode — o
 * post-it é papel claro nos dois temas), e o alfinete TONAL em 3 stops
 * (claro/médio/fundo) para a cabeça abaulada com brilho especular.
 */
export interface NotePalette {
  /** [topo, base] do gradiente do papel. */
  paper: [string, string];
  /** Cor do texto/caret — escura, casa com a família da cor. */
  text: string;
  /** [claro, médio, fundo] do domo do alfinete (mesma família, tonal). */
  pin: [string, string, string];
}

export const NOTE_PALETTE: Record<NoteColor, NotePalette> = {
  yellow: { paper: ['#fef3c7', '#fde68a'], text: '#5b4708', pin: ['#fcd34d', '#f59e0b', '#b45309'] },
  pink: { paper: ['#fee2e2', '#fecdd3'], text: '#7f1d1d', pin: ['#fca5a5', '#f43f5e', '#be123c'] },
  blue: { paper: ['#dbeafe', '#bfdbfe'], text: '#1e3a8a', pin: ['#93c5fd', '#3b82f6', '#1d4ed8'] },
  green: { paper: ['#dcfce7', '#bbf7d0'], text: '#14532d', pin: ['#86efac', '#22c55e', '#15803d'] },
  purple: { paper: ['#e0e7ff', '#c7d2fe'], text: '#3730a3', pin: ['#a5b4fc', '#6366f1', '#4338ca'] },
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
