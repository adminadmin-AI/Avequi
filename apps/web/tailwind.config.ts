import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── Avequi brand (Indigo) — brandbook v2.0 ───
        brand: {
          50: '#EEF2FF',
          200: '#C7D2FE',
          400: '#818CF8',
          500: '#6366F1',
          600: '#3D2CE6', // ★ Primary
          700: '#3427D1',
          950: '#1E1B4B',
        },
        // ─── Accent (Teal) ───
        accent: {
          DEFAULT: '#00C2A8',
        },
        // ─── Semantic ───
        success: '#16A34A',
        warning: '#F59E0B',
        danger: '#DC2626',
        info: '#2563EB',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        sm: '0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)',
        md: '0 4px 12px -2px rgb(15 23 42 / 0.10)',
        lg: '0 12px 24px -6px rgb(15 23 42 / 0.12)',
        xl: '0 24px 48px -12px rgb(15 23 42 / 0.18)',
      },
      transitionTimingFunction: {
        flow: 'cubic-bezier(0.16, 1, 0.3, 1)',
        precise: 'cubic-bezier(0.4, 0, 0.2, 1)',
        orbital: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      },
      transitionDuration: {
        micro: '80ms',
        fast: '120ms',
        flow: '200ms',
        deliberate: '320ms',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
