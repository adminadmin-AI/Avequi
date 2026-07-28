import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Wordmark AVECCHI — estado final da animação da landing (avecchi.ai):
 * o A do wordmark É o símbolo oficial da marca (logo.png), com o glow
 * "assentado" (indigo carrega a luz, sopro de teal). O tamanho segue o
 * font-size do pai — dimensione com text-*.
 *
 * Números do posicionamento medidos do PNG na landing (o desenho ocupa
 * y 4–246 de 299px): h-[0.9em] + mt-[0.12em] apoiam a base na baseline.
 */
const GLOW_SOFT =
  '0 0 22px rgba(255,255,255,0.12), 0 0 80px rgba(129,140,248,0.18), 0 0 150px rgba(61,44,230,0.12), 0 0 120px rgba(0,194,168,0.05)';

export function AvecchiWordmark({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="AVECCHI"
      className={cn(
        'inline-flex select-none font-bold leading-none tracking-[-0.02em] text-white',
        className,
      )}
      style={{ textShadow: GLOW_SOFT }}
    >
      <span aria-hidden className="relative inline-block">
        {/* o glifo invisível segura o layout; o símbolo ocupa o lugar do A */}
        <span className="opacity-0">A</span>
        <span className="absolute inset-0 flex justify-center">
          <Image
            src="/brand/logo.png"
            alt=""
            width={287}
            height={299}
            priority
            // max-w-none: o preflight põe max-width:100% em img e o container
            // flex tem a largura do "A" invisível — sem isto o símbolo espreme
            className="mt-[0.12em] h-[0.9em] w-auto max-w-none shrink-0 translate-x-[0.03em]"
          />
        </span>
      </span>
      <span aria-hidden>VECCHI</span>
    </span>
  );
}
