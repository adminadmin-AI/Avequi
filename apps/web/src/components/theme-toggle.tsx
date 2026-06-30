'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Toggle de tema claro/escuro (#302).
 * Alterna entre os temas resolvidos (light ↔ dark) preservando a escolha no
 * localStorage via next-themes. Antes de montar, renderiza um placeholder
 * neutro para evitar mismatch de hidratação (o tema só é conhecido no client).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => setMounted(true), []);

  const isDark = resolvedTheme === 'dark';

  const base =
    'rounded-lg p-2 text-content-secondary transition-colors duration-fast hover:bg-neutral-100 hover:text-content dark:hover:bg-neutral-800';

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Alternar tema"
        className={cn(base, className)}
        disabled
      >
        <Sun size={18} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      title={isDark ? 'Tema claro' : 'Tema escuro'}
      className={cn(base, 'focus-ring', className)}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
