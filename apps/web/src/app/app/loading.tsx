import { Skeleton } from '@/components/ui/skeleton';

/**
 * Loading de rota — F7.1 (#323): aparece enquanto o chunk JS da página
 * carrega (navegação code-split), evitando tela em branco/salto de layout.
 * Reserva a estrutura típica: header + fileira de KPIs + bloco de conteúdo.
 */
export default function AppLoading() {
  return (
    <div aria-busy="true" role="status" aria-label="Carregando página">
      <div className="mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="mb-5 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
