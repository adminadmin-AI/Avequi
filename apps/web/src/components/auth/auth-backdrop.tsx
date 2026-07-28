/**
 * Cenário das telas de autenticação — porta estática do Background da
 * landing (avecchi.ai): preto absoluto, os dois radial glows do hero
 * (indigo + teal), o mesh geométrico oficial do brandbook, geometria de
 * larga escala e vignette. Sem framer-motion de propósito: aqui o fade é
 * CSS puro (tailwindcss-animate) para não adicionar dependência ao app.
 */

/** Mesh geométrico oficial do brandbook (variante dark) — mesmo data-URI da landing. */
const MESH_SVG_DARK = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56'%3E%3Cline x1='0' y1='0' x2='28' y2='28' stroke='%23ffffff' stroke-width='0.5' opacity='0.08'/%3E%3Cline x1='28' y1='0' x2='56' y2='0' stroke='%23ffffff' stroke-width='0.5' opacity='0.05'/%3E%3Cline x1='0' y1='28' x2='28' y2='28' stroke='%23ffffff' stroke-width='0.5' opacity='0.05'/%3E%3Cline x1='28' y1='28' x2='56' y2='56' stroke='%23ffffff' stroke-width='0.5' opacity='0.04'/%3E%3Ccircle cx='0' cy='0' r='2' fill='%23ffffff' opacity='0.1'/%3E%3Ccircle cx='28' cy='0' r='1.5' fill='%23ffffff' opacity='0.05'/%3E%3Ccircle cx='56' cy='0' r='1.5' fill='%23ffffff' opacity='0.05'/%3E%3Ccircle cx='0' cy='28' r='1.5' fill='%23ffffff' opacity='0.05'/%3E%3Ccircle cx='28' cy='28' r='2' fill='%2300C2A8' opacity='0.2'/%3E%3Ccircle cx='56' cy='28' r='1.5' fill='%23ffffff' opacity='0.04'/%3E%3Ccircle cx='56' cy='56' r='1.5' fill='%23ffffff' opacity='0.15'/%3E%3C/svg%3E")`;

export function AuthBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 animate-in fade-in duration-deliberate"
    >
      {/* Glows do hero do brandbook, rebaixados para o preto absoluto */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 18% 42%, rgba(61,44,230,.13) 0%, transparent 55%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 55% at 82% 82%, rgba(0,194,168,.06) 0%, transparent 50%)',
        }}
      />

      {/* Mesh geométrico — quase invisível, some nas bordas */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage: MESH_SVG_DARK,
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse 75% 65% at 50% 45%, black 0%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 75% 65% at 50% 45%, black 0%, transparent 75%)',
        }}
      />

      {/* Geometria de larga escala — círculos e diagonais, traço mínimo */}
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
      >
        <circle cx="1180" cy="140" r="320" stroke="rgba(255,255,255,0.035)" strokeWidth="1" />
        <circle cx="180" cy="820" r="260" stroke="rgba(129,140,248,0.05)" strokeWidth="1" />
        <line x1="-60" y1="760" x2="620" y2="80" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
        <line x1="860" y1="900" x2="1500" y2="260" stroke="rgba(0,194,168,0.045)" strokeWidth="1" />
      </svg>

      {/* Vignette — mantém as bordas em preto absoluto */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 80% at 50% 50%, transparent 55%, rgba(0,0,0,.85) 100%)',
        }}
      />
    </div>
  );
}
