'use client';

import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { erroExigeMfa } from '@/lib/mfa';

/**
 * Atalho "Ativar agora" no card de Acesso negado do console (#936).
 *
 * O OpsMfaGuard responde 403 com "O portal da operadora exige MFA
 * (verificação em duas etapas) ativo. Habilite o MFA no seu perfil…" — uma
 * negativa que o próprio usuário resolve em 1 minuto. Sem este link ele lê a
 * instrução e não tem para onde ir (a tela de Segurança mora no menu do
 * avatar, três cliques longe e sem pista nenhuma daqui).
 *
 * Renderiza NADA quando a mensagem é de permissão comum — 403 de `ops.*` que
 * o usuário não tem não vira convite a mexer no MFA.
 */
export function AtivarMfaLink({ message }: { message?: string | null }) {
  if (!erroExigeMfa(message)) return null;

  return (
    <Link
      href="/app/account/security"
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(16_24_40/0.18)] transition-[color,background-color,box-shadow,transform] duration-fast ease-precise hover:-translate-y-px hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <ShieldCheck size={16} />
      Ativar agora
      <ArrowRight size={16} />
    </Link>
  );
}
