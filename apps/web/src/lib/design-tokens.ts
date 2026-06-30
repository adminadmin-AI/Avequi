/**
 * Design tokens — Avequi ERP (brandbook v2.0)
 *
 * Fonte da verdade em JS/TS para os tokens definidos em `tailwind.config.ts`
 * e `globals.css`. Use as classes Tailwind no JSX sempre que possível
 * (`text-display`, `bg-surface`, `shadow-elevation-3`, …); estas constantes
 * existem para casos que precisam do valor bruto (libs de gráfico, estilos
 * inline, cálculos).
 *
 * Issues: #300 (cores), #301 (tipografia/spacing/elevation), #302 (dark mode).
 */

// ─── Type scale ────────────────────────────────────────────────────────────
export const typography = {
  display: { size: '36px', lineHeight: '40px', letterSpacing: '-0.02em', weight: 600 },
  heading: { size: '24px', lineHeight: '32px', letterSpacing: '-0.015em', weight: 600 },
  title: { size: '18px', lineHeight: '28px', letterSpacing: '-0.01em', weight: 500 },
  subtitle: { size: '16px', lineHeight: '24px', letterSpacing: '0', weight: 500 },
  body: { size: '14px', lineHeight: '20px', letterSpacing: '0', weight: 400 },
  caption: { size: '12px', lineHeight: '16px', letterSpacing: '0', weight: 500 },
  helper: { size: '11px', lineHeight: '14px', letterSpacing: '0', weight: 400 },
} as const;

// ─── Spacing scale (px) — espelha a escala default do Tailwind ──────────────
export const spacing = {
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// ─── Border radius ──────────────────────────────────────────────────────────
export const radius = {
  none: '0',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '12px',
  '2xl': '16px',
  full: '9999px',
} as const;

// ─── Elevation system ───────────────────────────────────────────────────────
export const elevation = {
  0: 'shadow-elevation-0', // flat surfaces
  1: 'shadow-elevation-1', // cards resting
  2: 'shadow-elevation-2', // cards hover
  3: 'shadow-elevation-3', // dropdowns, popovers
  4: 'shadow-elevation-4', // modals
  5: 'shadow-elevation-5', // command palette
} as const;

// ─── Motion tokens (ms) — respeitam prefers-reduced-motion via globals.css ──
export const motion = {
  micro: 80, // hover, focus
  fast: 120, // button press, toggle
  flow: 200, // panel transitions
  deliberate: 320, // modal open/close, page transitions
} as const;

export const easing = {
  flow: 'cubic-bezier(0.16, 1, 0.3, 1)',
  precise: 'cubic-bezier(0.4, 0, 0.2, 1)',
  orbital: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

// ─── Paleta (hex bruto) — útil p/ recharts e estilos inline ─────────────────
// Mantém paridade 1:1 com tailwind.config.ts.
export const colors = {
  brand: {
    DEFAULT: '#3D2CE6',
    50: '#EEF2FF',
    100: '#E0E7FF',
    200: '#C7D2FE',
    300: '#A5B4FC',
    400: '#818CF8',
    500: '#6366F1',
    600: '#3D2CE6',
    700: '#3427D1',
    800: '#2A1FA8',
    900: '#221A85',
    950: '#1E1B4B',
  },
  accent: { DEFAULT: '#00C2A8' },
  success: { DEFAULT: '#16A34A' },
  warning: { DEFAULT: '#F59E0B' },
  danger: { DEFAULT: '#DC2626' },
  info: { DEFAULT: '#2563EB' },
  neutral: {
    50: '#F8FAFC',
    100: '#F1F5F9',
    200: '#E2E8F0',
    300: '#CBD5E1',
    400: '#94A3B8',
    500: '#64748B',
    600: '#475569',
    700: '#334155',
    800: '#1E293B',
    900: '#0F172A',
    950: '#020617',
  },
} as const;

export type ThemeMode = 'light' | 'dark' | 'system';
