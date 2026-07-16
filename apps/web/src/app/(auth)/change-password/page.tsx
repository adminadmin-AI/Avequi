'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, KeyRound } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import {
  clearPendingPasswordChange,
  readPendingPasswordChange,
  type PendingPasswordChange,
} from '@/lib/password-change';
import { BrandMark } from '@/components/brand-mark';
import { PasswordChangeForm } from '@/components/password/password-change-form';

/**
 * Definição de nova senha — fluxo FORÇADO (#735): primeiro acesso
 * (mustChangePassword, padrão do #468 para usuário criado/resetado pelo
 * admin) ou senha vencida por rotação (#345).
 *
 * Chega-se aqui SÓ via login: o /auth/login devolve um passwordChangeToken
 * restrito (10 min) em vez dos tokens finais, e a tela de login grava o
 * handoff no sessionStorage antes de redirecionar. Sem handoff válido
 * (acesso direto, refresh após expirar), volta ao login.
 *
 * Após trocar, faz login automático com a nova senha; se algo impedir
 * (ex.: MFA da conta), cai no login com aviso de sucesso.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);
  const [pending, setPending] = useState<PendingPasswordChange | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const record = readPendingPasswordChange(window.sessionStorage);
    if (!record) {
      router.replace('/login?reason=password-change-expired');
      return;
    }
    setPending(record);
    setChecked(true);
  }, [router]);

  async function handleSuccess(newPassword: string) {
    clearPendingPasswordChange(window.sessionStorage);
    try {
      const result = await login(pending!.email, newPassword);
      if (!result.passwordChangeRequired) {
        router.push('/app');
        return;
      }
    } catch {
      // login automático é conveniência — a troca em si já deu certo.
    }
    router.push('/login?reason=password-changed');
  }

  if (!checked || !pending) return null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-6 py-10">
      <div className="w-full max-w-sm duration-deliberate animate-in fade-in slide-in-from-bottom-2">
        <div className="mb-8 flex items-center gap-2.5">
          <BrandMark size={28} />
          <span className="text-title font-semibold tracking-tight text-content">Avequi</span>
        </div>

        <div className="mb-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-300">
            <KeyRound size={20} />
          </div>
          <h1 className="text-heading text-content">Defina sua nova senha</h1>
          <p className="mt-1 text-body text-content-secondary">
            {pending.passwordExpired
              ? 'Sua senha venceu. Escolha uma nova para continuar.'
              : 'Este é seu primeiro acesso. Escolha uma senha só sua para continuar.'}
          </p>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-caption text-warning-800 dark:border-warning-900 dark:bg-warning-900/20 dark:text-warning-300">
          <AlertCircle size={16} className="mt-px shrink-0" />
          <span>
            Você tem 10 minutos para concluir. Se expirar, é só fazer login de novo com a senha
            provisória.
          </span>
        </div>

        <PasswordChangeForm
          mode="forced"
          passwordChangeToken={pending.passwordChangeToken}
          submitLabel="Definir senha e entrar"
          onSuccess={handleSuccess}
          onRestrictedTokenRejected={() => {
            clearPendingPasswordChange(window.sessionStorage);
            router.replace('/login?reason=password-change-expired');
          }}
        />
      </div>
    </div>
  );
}
