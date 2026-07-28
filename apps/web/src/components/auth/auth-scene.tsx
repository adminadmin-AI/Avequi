'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthBackdrop } from './auth-backdrop';
import { FlowField } from './flow-field';

/**
 * Cena de fundo das telas de auth: backdrop da landing + campo de fluxo,
 * em duas camadas com parallax sutil seguindo o mouse (±6/±12px, lerp em
 * rAF — só transform, nunca layout). Parallax e pulsos desligam para
 * prefers-reduced-motion e para ponteiro grosso (touch).
 */
export function AuthScene() {
  const backRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  // SSR-safe: começa tudo parado; hidrata com a preferência real.
  // Pulsos respeitam só reduced-motion (celular merece o fundo vivo);
  // parallax exige também ponteiro fino (mouse).
  const [reduced, setReduced] = useState(true);
  const [still, setStill] = useState(true);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarse = window.matchMedia('(pointer: coarse)');
    const update = () => {
      setReduced(reduce.matches);
      setStill(reduce.matches || coarse.matches);
    };
    update();
    reduce.addEventListener('change', update);
    coarse.addEventListener('change', update);
    return () => {
      reduce.removeEventListener('change', update);
      coarse.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    if (still) {
      backRef.current?.style.setProperty('transform', 'translate3d(0,0,0)');
      midRef.current?.style.setProperty('transform', 'translate3d(0,0,0)');
      return;
    }
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    const onMove = (e: MouseEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
    };
    const tick = () => {
      // lerp suave — o fundo "acompanha" o mouse, não o persegue
      cx += (tx - cx) * 0.045;
      cy += (ty - cy) * 0.045;
      if (backRef.current)
        backRef.current.style.transform = `translate3d(${cx * -6}px, ${cy * -6}px, 0)`;
      if (midRef.current)
        midRef.current.style.transform = `translate3d(${cx * -13}px, ${cy * -13}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [still]);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden animate-in fade-in duration-deliberate">
      {/* sangria de 24px em cada borda: o parallax nunca revela o limite */}
      <div ref={backRef} className="absolute -inset-6 will-change-transform">
        <AuthBackdrop />
      </div>
      <div ref={midRef} className="absolute -inset-6 will-change-transform">
        <FlowField reduced={reduced} />
      </div>
    </div>
  );
}
