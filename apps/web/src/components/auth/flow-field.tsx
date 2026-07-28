/**
 * Campo de fluxo das telas de auth — linhas tecnológicas atravessando o
 * fundo e convergindo para a região do wordmark (canto superior esquerdo
 * do painel institucional), com pulsos de luz percorrendo os caminhos.
 * A metáfora é a da landing: dados saindo do improviso e entrando no fluxo.
 *
 * Pulsos usam SMIL (<animateMotion>) — nativo, leve e sem lib. O CSS
 * global de prefers-reduced-motion não alcança SMIL, então quem pediu
 * menos movimento recebe `reduced` e os pulsos nem são renderizados
 * (as linhas ficam, estáticas).
 */

const PATHS = [
  // da borda direita, alto — varre o topo até o wordmark
  'M 1520 170 C 1040 130, 560 210, 138 116',
  // da borda direita, baixo — sobe em arco pelo meio
  'M 1520 660 C 960 570, 500 330, 148 132',
  // do rodapé esquerdo — sobe rente ao painel
  'M -60 800 C 250 650, 170 330, 128 142',
  // do rodapé central — diagonal longa
  'M 720 960 C 630 690, 340 420, 152 152',
] as const;

/** [cor do pulso, duração (s), atraso inicial negativo (s)] por caminho */
const PULSES: ReadonlyArray<readonly [string, number, number]> = [
  ['#00C2A8', 11, -2],
  ['#818CF8', 14, -9],
  ['#00C2A8', 13, -5],
  ['#818CF8', 16, -12],
];

export function FlowField({ reduced }: { reduced: boolean }) {
  return (
    <svg
      aria-hidden
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1440 900"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="af-line-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="0.8" stopColor="#818CF8" stopOpacity="0.1" />
          <stop offset="1" stopColor="#818CF8" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {PATHS.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke="url(#af-line-grad)"
          strokeWidth="1"
          className="af-line"
          style={{ animationDelay: `${i * -3.5}s` }}
        />
      ))}

      {!reduced &&
        PATHS.map((d, i) => {
          const [color, dur, begin] = PULSES[i];
          return (
            <g key={`pulse-${d}`}>
              {/* halo + núcleo compartilham o mesmo animateMotion no <g> */}
              <circle r="7" fill={color} opacity="0.1" />
              <circle r="1.8" fill={color} opacity="0.75" />
              <animateMotion
                dur={`${dur}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
                path={d}
                calcMode="spline"
                keyPoints="0;1"
                keyTimes="0;1"
                keySplines="0.3 0 0.4 1"
              />
              {/* nasce e morre suave nas pontas do caminho */}
              <animate
                attributeName="opacity"
                values="0;1;1;0"
                keyTimes="0;0.12;0.82;1"
                dur={`${dur}s`}
                begin={`${begin}s`}
                repeatCount="indefinite"
              />
            </g>
          );
        })}
    </svg>
  );
}
