'use client';

import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { useToast } from '@/components/ui/toast';
import { PasswordChangeForm } from '@/components/password/password-change-form';

/**
 * Troca voluntária de senha (#736) — usuário logado, qualquer perfil
 * (autoatendimento: rota fora do NAV de propósito, sem gate de permissão;
 * o backend exige Bearer + reconfirma a senha atual).
 *
 * Efeito colateral importante (#345): a troca revoga TODAS as outras
 * sessões do usuário (a atual permanece) — comunicado na tela e no toast.
 *
 * Pós-sucesso: volta ao Início (feedback do smoke v1.15.0 — permanecer na
 * página com o form vazio deixava a sensação de tarefa inacabada); o toast
 * de confirmação sobrevive à navegação.
 */
export default function AccountPasswordPage() {
  const toast = useToast();
  const router = useRouter();

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader
        title="Alterar senha"
        description="Troque a senha da sua conta. Você continua conectado neste dispositivo."
      />

      <div className="rounded-lg border p-4">
        <PasswordChangeForm
          mode="voluntary"
          submitLabel="Alterar senha"
          onSuccess={() => {
            toast.success('Senha alterada. Suas outras sessões foram desconectadas.');
            router.push('/app');
          }}
        />
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2.5 text-caption text-content-secondary">
        <ShieldCheck size={16} className="mt-px shrink-0 text-content-muted" />
        <span>
          Por segurança, ao alterar a senha todas as suas outras sessões (outros navegadores e
          dispositivos) são desconectadas — só esta permanece ativa.
        </span>
      </div>
    </div>
  );
}
