'use client';

import { useEffect } from 'react';

/**
 * Fallback de último recurso (#320): captura erros do PRÓPRIO root layout.
 * Substitui todo o documento, então precisa renderizar <html>/<body> e não
 * conta com o CSS global — por isso usa estilos inline mínimos.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global] erro fatal:', error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#fff' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            padding: 24,
            textAlign: 'center',
            color: '#0f172a',
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Algo deu errado</h2>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0, maxWidth: 420 }}>
            Ocorreu um erro inesperado. Recarregue a página e tente novamente.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 8,
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #e2e8f0',
              background: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
