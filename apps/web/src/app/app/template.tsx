/**
 * Template do app — F8.1 (#324): fade-in suave (200ms) ao entrar em cada
 * página. template.tsx remonta a cada navegação (diferente do layout),
 * então a animação roda em toda troca de rota. Respeita
 * prefers-reduced-motion via regra global (#322).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="duration-flow animate-in fade-in">{children}</div>;
}
