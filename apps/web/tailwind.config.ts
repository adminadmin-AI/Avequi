import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ─── Avequi brand (Indigo) — brandbook v2.0 · escala 50-950 ───
        brand: {
          DEFAULT: '#3D2CE6', // ★ Primary (= 600), preserva uso flat `bg-brand`/`text-brand`
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
        // ─── Accent (Teal) ───
        accent: {
          DEFAULT: '#00C2A8',
          50: '#ECFEFB',
          100: '#CFFBF3',
          200: '#9FF5E7',
          300: '#5FE9D6',
          400: '#2AD3BF',
          500: '#00C2A8',
          600: '#009E8B',
          700: '#007E70',
          800: '#06635A',
          900: '#08524B',
        },
        // ─── Semânticas (cada uma com DEFAULT p/ uso flat + escala 50-900) ───
        success: {
          DEFAULT: '#16A34A',
          50: '#F0FDF4',
          100: '#DCFCE7',
          200: '#BBF7D0',
          300: '#86EFAC',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#15803D',
          800: '#166534',
          900: '#14532D',
        },
        warning: {
          DEFAULT: '#F59E0B',
          50: '#FFFBEB',
          100: '#FEF3C7',
          200: '#FDE68A',
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309',
          800: '#92400E',
          900: '#78350F',
        },
        danger: {
          DEFAULT: '#DC2626',
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#EF4444',
          600: '#DC2626',
          700: '#B91C1C',
          800: '#991B1B',
          900: '#7F1D1D',
        },
        info: {
          DEFAULT: '#2563EB',
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          300: '#93C5FD',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
          800: '#1E40AF',
          900: '#1E3A8A',
        },
        // ─── Neutral (substitui slate ad-hoc) ───
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
        // ─── Tokens semânticos (dark-mode aware via CSS vars) ───
        // Use `bg-surface`, `text-content`, `border-line`, etc.
        surface: {
          DEFAULT: 'var(--bg-primary)',
          secondary: 'var(--bg-secondary)',
          elevated: 'var(--bg-elevated)',
          overlay: 'var(--surface-overlay)',
        },
        content: {
          DEFAULT: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        line: {
          DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
      },
      // ─── Type scale (text-display, text-heading, text-title, …) ───
      fontSize: {
        display: ['36px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '600' }],
        heading: ['24px', { lineHeight: '32px', letterSpacing: '-0.015em', fontWeight: '600' }],
        title: ['18px', { lineHeight: '28px', letterSpacing: '-0.01em', fontWeight: '500' }],
        subtitle: ['16px', { lineHeight: '24px', fontWeight: '500' }],
        body: ['14px', { lineHeight: '20px', fontWeight: '400' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        helper: ['11px', { lineHeight: '14px', fontWeight: '400' }],
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
        // primitivos
        xs: '0 1px 2px 0 rgb(15 23 42 / 0.04)',
        sm: '0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)',
        md: '0 4px 12px -2px rgb(15 23 42 / 0.10)',
        lg: '0 12px 24px -6px rgb(15 23 42 / 0.12)',
        xl: '0 24px 48px -12px rgb(15 23 42 / 0.18)',
        // ─── Elevation system (semântico) ───
        'elevation-0': 'none',
        'elevation-1': '0 1px 2px 0 rgb(15 23 42 / 0.04)', // cards resting
        'elevation-2': '0 1px 3px 0 rgb(15 23 42 / 0.08), 0 1px 2px -1px rgb(15 23 42 / 0.06)', // cards hover
        'elevation-3': '0 4px 12px -2px rgb(15 23 42 / 0.10)', // dropdowns, popovers
        'elevation-4': '0 12px 24px -6px rgb(15 23 42 / 0.12)', // modals
        'elevation-5': '0 24px 48px -12px rgb(15 23 42 / 0.18)', // command palette
      },
      transitionTimingFunction: {
        flow: 'cubic-bezier(0.16, 1, 0.3, 1)',
        precise: 'cubic-bezier(0.4, 0, 0.2, 1)',
        orbital: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
        exit: 'cubic-bezier(0.4, 0, 1, 1)',
      },
      transitionDuration: {
        micro: '80ms', // hover, focus
        fast: '120ms', // button press, toggle
        flow: '200ms', // panel transitions
        deliberate: '320ms', // modal open/close, page transitions
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
