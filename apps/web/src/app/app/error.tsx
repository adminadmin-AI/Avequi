'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

/**
 * Error boundary do módulo autenticado (#320). Captura erros de qualquer
 * página sob /app e renderiza o fallback DENTRO do shell (sidebar/header
 * permanecem), com botão de retry que reseta o boundary.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // report (console; futuro: Sentry)
    console.error('[app] erro não tratado:', error);
  }, [error]);

  return <ErrorState error={error} onRetry={reset} />;
}
