import { cn } from '@/lib/utils';

/**
 * Skeleton primitivo (F4.1 / #318). Bloco cinza com pulse suave que preserva
 * o layout durante o carregamento (evita CLS). Dark-mode aware e respeita
 * prefers-reduced-motion (sem animação, cor estática).
 *
 * Line/Rect/Circle = mesmo primitivo com className diferente:
 *   <Skeleton className="h-4 w-32" />           // linha
 *   <Skeleton className="h-10 w-10 rounded-full" /> // círculo
 *   <Skeleton className="h-24 w-full rounded-xl" /> // retângulo
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-neutral-200 motion-reduce:animate-none dark:bg-neutral-800',
        className,
      )}
    />
  );
}
