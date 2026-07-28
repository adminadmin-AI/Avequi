import type { Metadata } from 'next';
import { AuthScene } from '@/components/auth/auth-scene';

export const metadata: Metadata = {
  // o template do layout raiz ('%s — Avecchi') já anexa a marca
  title: 'Entrar',
  description: 'Conectando pessoas, processos e resultados.',
};

/**
 * Shell das telas de autenticação — continuação visual da landing
 * (avecchi.ai): preto absoluto + backdrop oficial da marca. O wrapper
 * `.dark` força as variantes dark do design system aqui dentro,
 * independente do tema escolhido dentro do app.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark relative min-h-screen bg-black text-white">
      <AuthScene />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
