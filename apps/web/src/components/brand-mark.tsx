import { cn } from '@/lib/utils';

/**
 * Marca Avequi — "três nós conectados" (process node chain) do brandbook.
 * Usa o gradiente da marca (Indigo → Teal) quando `gradient`.
 */
export function BrandMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={cn('shrink-0', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="avequi-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3D2CE6" />
          <stop offset="1" stopColor="#00C2A8" />
        </linearGradient>
      </defs>
      {/* conexões */}
      <path d="M9 9 L23 16 L9 23" stroke="url(#avequi-mark)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* nós */}
      <circle cx="9" cy="9" r="3.5" fill="url(#avequi-mark)" />
      <circle cx="23" cy="16" r="3.5" fill="url(#avequi-mark)" />
      <circle cx="9" cy="23" r="3.5" fill="url(#avequi-mark)" />
    </svg>
  );
}
