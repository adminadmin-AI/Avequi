'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/ui/error-state';

/**
 * Error boundary de nível raiz (#320). Cobre rotas fora de /app (login,
 * portal, etc.) e erros do próprio layout de /app.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[root] erro não tratado:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-surface">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
