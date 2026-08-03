'use client';

import { useEffect, useRef, useState } from 'react';
import * as impersonation from '@/lib/impersonation';
import type { ImpersonationSession } from '@/lib/impersonation';
import { Button } from '@/components/ui/button';

/** mm:ss a partir de uma diferença em ms — nunca negativo. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Banner INCONFUNDÍVEL de sessão de suporte (impersonation) — OPS WP6
 * (#913). Só existe enquanto `impersonation.isActive()` tiver uma sessão
 * gravada; some sozinho depois do `end()` (que navega para longe do app).
 *
 * Leitura da sessão fica atrás de um `mounted` (mesmo truque do AppLayout
 * para o isAuthenticated): ler localStorage direto no primeiro render
 * causaria mismatch de hidratação — no servidor não há window.
 *
 * Countdown zerado dispara o encerramento automático (best-effort no
 * backend, sempre local) — `endingRef` evita disparo duplicado entre o
 * tick do setInterval e um clique manual simultâneo no botão.
 */
export function ImpersonationBanner() {
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const endingRef = useRef(false);

  useEffect(() => {
    setSession(impersonation.isActive());
  }, []);

  useEffect(() => {
    if (!session) return;
    const expiresAt = new Date(session.expiresAt).getTime();

    function tick() {
      const remaining = expiresAt - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0 && !endingRef.current) {
        endingRef.current = true;
        void impersonation.end();
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session]);

  if (!session) return null;

  async function handleEnd() {
    if (endingRef.current) return;
    endingRef.current = true;
    await impersonation.end();
  }

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/60 bg-gradient-to-r from-amber-500 to-purple-600 px-4 py-2.5 text-sm font-medium text-white sm:px-6"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden>🛟</span>
        <span className="truncate">
          Suporte Avecchi visualizando como {session.targetName} — expira em{' '}
          <span className="font-mono tabular-nums">{formatCountdown(remainingMs)}</span>
        </span>
      </span>
      <Button variant="secondary" size="sm" onClick={handleEnd}>
        Encerrar sessão de suporte
      </Button>
    </div>
  );
}
