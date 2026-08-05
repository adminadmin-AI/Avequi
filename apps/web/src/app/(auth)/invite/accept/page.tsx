'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Eye, EyeOff, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { mensagemDoErro } from '@/lib/api-error';
import { AvecchiWordmark } from '@/components/auth/avecchi-wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  historySize: number;
  description: string;
}

/**
 * Aceite público do convite de primeiro acesso do admin do tenant
 * (OPS WP2 #909). Chega-se aqui pelo link do e-mail enviado pelo
 * TenantInviteService: POST /invite/accept, token uso único (72h).
 *
 * Sem sessão/handoff — o token vem inteiro na query string (é assim que o
 * e-mail funciona) e é a ÚNICA credencial deste fluxo.
 */
export default function AcceptInvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{ email: string } | null>(null);

  // Lido no mount (URL = estado inicial) — mesmo padrão do login/change-password
  // desta pasta, fora do render p/ não brigar com o prerender do Next.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    setChecked(true);
  }, []);

  const { data: policy } = useQuery<PasswordPolicy>({
    queryKey: ['password-policy'],
    queryFn: async () => (await apiClient.get('/auth/password-policy')).data,
    staleTime: Infinity,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Link de convite inválido: falta o token. Verifique o link recebido por e-mail.');
      return;
    }
    if (password !== confirmPassword) {
      setError('A confirmação não confere com a senha.');
      return;
    }
    const minLength = policy?.minLength ?? 10;
    if (password.length < minLength) {
      setError(`A senha precisa de pelo menos ${minLength} caracteres.`);
      return;
    }

    setLoading(true);
    try {
      const { data } = await apiClient.post<{ ok: true; email: string }>('/invite/accept', {
        token,
        password,
      });
      setSuccess({ email: data.email });
    } catch (err) {
      setError(
        mensagemDoErro(err) ??
          'Não foi possível concluir o cadastro. Tente novamente em instantes.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (!checked) return null;

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
          <div
            aria-hidden
            className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
          />

          {success ? (
            <>
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#00C2A8]/15 text-[#5eead4]">
                <CheckCircle2 size={20} />
              </div>
              <h1 className="text-[22px] font-semibold tracking-tight text-white">
                Senha definida
              </h1>
              <p className="mt-1.5 text-sm font-light text-white/55">
                Sua conta ({success.email}) está pronta. Entre com a senha que você acabou de
                criar.
              </p>
              <Link href="/login" className="mt-6 block">
                <Button size="lg" className="w-full">
                  Ir para o login
                </Button>
              </Link>
            </>
          ) : (
            <>
              <div className="mb-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#3D2CE6]/20 text-[#818CF8]">
                  <KeyRound size={20} />
                </div>
                <h1 className="text-[22px] font-semibold tracking-tight text-white">
                  Bem-vindo à Avecchi
                </h1>
                <p className="mt-1.5 text-sm font-light text-white/55">
                  Defina a senha da sua conta de administrador para concluir o cadastro.
                </p>
              </div>

              {!token && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-[13px] text-amber-200">
                  <AlertCircle size={16} className="mt-px shrink-0" />
                  <span>
                    Este link não tem um token de convite válido. Abra o link recebido por e-mail
                    completo, sem editar.
                  </span>
                </div>
              )}

              <div className="mb-4 flex items-start gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[13px] text-white/60">
                <ShieldCheck size={16} className="mt-px shrink-0 text-white/40" />
                <span>
                  {policy?.description ??
                    `Mínimo de ${policy?.minLength ?? 10} caracteres, com maiúscula, minúscula, número e caractere especial.`}
                </span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                <div>
                  <Label htmlFor="password" className="text-[13px] text-white/70">
                    Nova senha
                  </Label>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-white/30"
                    />
                    <Input
                      id="password"
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      error={!!error}
                      required
                      className="border-white/10 bg-white/[0.05] px-9 text-white placeholder:text-white/25 hover:border-white/20 focus:border-[#818CF8]/60"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPasswords((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPasswords ? 'Ocultar senhas' : 'Mostrar senhas'}
                      className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-white/30 transition-colors hover:text-white"
                    >
                      {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div>
                  <Label htmlFor="confirm-password" className="text-[13px] text-white/70">
                    Confirmar nova senha
                  </Label>
                  <div className="relative">
                    <Lock
                      size={16}
                      className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-white/30"
                    />
                    <Input
                      id="confirm-password"
                      type={showPasswords ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      error={!!error}
                      required
                      className="border-white/10 bg-white/[0.05] px-9 text-white placeholder:text-white/25 hover:border-white/20 focus:border-[#818CF8]/60"
                    />
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 whitespace-pre-line rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-[13px] text-red-300"
                  >
                    <AlertCircle size={16} className="mt-px shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" size="lg" loading={loading} className="w-full">
                  {loading ? 'Salvando…' : 'Definir senha e entrar'}
                </Button>
              </form>
            </>
          )}
        </div>

        {!success && (
          <p className="mt-6 text-center text-[12px] font-light leading-relaxed text-white/35">
            Convite inválido ou expirado?
            <br />
            Peça um novo convite ao suporte da Avecchi.
          </p>
        )}
      </div>
    </div>
  );
}
