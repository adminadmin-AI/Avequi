import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Wordmark AVECCHI — estado final da animação da landing (avecchi.ai):
 * o A do wordmark É o símbolo oficial da marca (logo.png), com o glow
 * "assentado" (indigo carrega a luz, sopro de teal). O tamanho segue o
 * font-size do pai — dimensione com text-*.
 *
 * `animated`: versão compacta (~2,7s) da revelação da landing, em CSS
 * puro (classes wm-* no globals.css): A+I aparecem, VECCH nasce entre
 * eles com blur, e o A cede o lugar ao símbolo. Reduced-motion pula
 * direto pro estado final.
 *
 * Posicionamento CALIBRADO POR MEDIÇÃO do render (Playwright dpr3 + PIL,
 * corpo do símbolo vs cap/baseline do "V"): h-[0.9em] + mt-[0.36em] =
 * base na baseline (delta 0px) e ápice no cap top. Os valores da landing
 * (mt 0.12em) NÃO valem aqui — o contexto de linha difere. Se mexer,
 * re-medir; não confiar em teoria de métricas de fonte.
 */
const GLOW_SOFT =
  '0 0 22px rgba(255,255,255,0.12), 0 0 80px rgba(129,140,248,0.18), 0 0 150px rgba(61,44,230,0.12), 0 0 120px rgba(0,194,168,0.05)';

const MIDDLE = ['V', 'E', 'C', 'C', 'H'] as const;

const markImg = (
  <Image
    src="/brand/logo.png"
    alt=""
    width={287}
    height={299}
    priority
    // max-w-none: o preflight põe max-width:100% em img e o container
    // flex tem a largura do "A" invisível — sem isto o símbolo espreme
    className="mt-[0.36em] h-[0.9em] w-auto max-w-none shrink-0 translate-x-[0.03em]"
  />
);

export function AvecchiWordmark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  const base = cn(
    'inline-flex select-none font-bold leading-none tracking-[-0.02em] text-white',
    className,
  );

  if (!animated) {
    return (
      <span role="img" aria-label="AVECCHI" className={base} style={{ textShadow: GLOW_SOFT }}>
        <span aria-hidden className="relative inline-block">
          {/* o glifo invisível segura o layout; o símbolo ocupa o lugar do A */}
          <span className="opacity-0">A</span>
          <span className="absolute inset-0 flex justify-center">{markImg}</span>
        </span>
        <span aria-hidden>VECCHI</span>
      </span>
    );
  }

  return (
    <span role="img" aria-label="AVECCHI" className={base} style={{ textShadow: GLOW_SOFT }}>
      {/* O A encena como glifo e cede ao símbolo — o payoff da landing */}
      <span aria-hidden className="wm-anchor relative inline-block">
        <span className="wm-glyph inline-block">A</span>
        <span className="wm-mark absolute inset-0 flex justify-center">{markImg}</span>
      </span>
      {MIDDLE.map((letter, i) => (
        <span
          key={`${letter}-${i}`}
          aria-hidden
          className="wm-letter"
          style={{ animationDelay: `${500 + i * 130}ms` }}
        >
          <span className="wm-letter-inner" style={{ animationDelay: `${500 + i * 130}ms` }}>
            {letter}
          </span>
        </span>
      ))}
      <span aria-hidden className="wm-anchor inline-block">
        I
      </span>
    </span>
  );
}
