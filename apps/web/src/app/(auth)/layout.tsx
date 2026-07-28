import type { Metadata } from 'next';
import { AuthBackdrop } from '@/components/auth/auth-backdrop';

export const metadata: Metadata = {
  // o template do layout raiz ('%s — Avecchi') já anexa a marca
  title: 'Entrar',
  description:
    'Acesse o Avecchi Industrial ERP — produção, estoque, compras, PCP, fiscal e financeiro em uma única plataforma.',
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
      <AuthBackdrop />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
