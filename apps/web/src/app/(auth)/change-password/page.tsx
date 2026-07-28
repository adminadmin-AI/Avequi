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
import { AvecchiWordmark } from '@/components/auth/avecchi-wordmark';
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
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="relative mx-auto mb-10 w-fit duration-deliberate animate-in fade-in slide-in-from-top-2">
          <div
            aria-hidden
            className="animate-avecchi-breathe absolute -inset-x-12 -inset-y-7 rounded-full blur-2xl"
            style={{
              background:
                'radial-gradient(ellipse 70% 80% at 50% 50%, rgba(61,44,230,0.30) 0%, rgba(0,194,168,0.06) 60%, transparent 100%)',
            }}
          />
          <AvecchiWordmark className="relative text-[28px]" />
        </div>

        <div
          className="relative rounded-2xl border border-white/[0.12] bg-white/[0.055] p-8 backdrop-blur-xl duration-deliberate animate-in fade-in slide-in-from-bottom-2"
          style={{
            boxShadow:
              '0 0 40px rgba(61,44,230,0.10), 0 0 90px rgba(61,44,230,0.05), 0 12px 40px rgba(0,0,0,0.45)',
          }}
        >
          {/* fio de luz no topo do card — detalhe de profundidade */}
          <div
            aria-hidden
            className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          />
          <div className="mb-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#3D2CE6]/20 text-[#818CF8]">
              <KeyRound size={20} />
            </div>
            <h1 className="text-[22px] font-semibold tracking-tight text-white">
              Defina sua nova senha
            </h1>
            <p className="mt-1.5 text-sm font-light text-white/55">
              {pending.passwordExpired
                ? 'Sua senha venceu. Escolha uma nova para continuar.'
                : 'Este é seu primeiro acesso. Escolha uma senha só sua para continuar.'}
            </p>
          </div>

          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-[13px] text-amber-200">
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
    </div>
  );
}
