'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { clearPendingPasswordChange, storePendingPasswordChange } from '@/lib/password-change';
import { AvecchiWordmark } from '@/components/auth/avecchi-wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const REMEMBER_KEY = 'avequi:remember-email';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0); // força re-trigger da animação de shake
  const [notice, setNotice] = useState<'expired' | 'password-changed' | 'password-change-expired' | null>(null);

  // Carrega e-mail lembrado + detecta avisos vindos por ?reason= (sessão
  // expirada, senha recém-trocada, handoff de troca de senha vencido).
  // Voltar ao login invalida qualquer handoff pendente de troca de senha —
  // um novo login emite token novo; o antigo não deve sobreviver aqui.
  useEffect(() => {
    clearPendingPasswordChange(window.sessionStorage);
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');
    if (reason === 'expired' || reason === 'password-changed' || reason === 'password-change-expired') {
      setNotice(reason);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice(null);
    try {
      const result = await login(email, password);
      if (remember) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);
      // Troca de senha obrigatória (#735): sem tokens finais — handoff do
      // token restrito via sessionStorage (nunca URL) e segue para a tela
      // de definição de nova senha.
      if (result.passwordChangeRequired) {
        storePendingPasswordChange(window.sessionStorage, {
          passwordChangeToken: result.passwordChangeToken,
          email,
          passwordExpired: result.passwordExpired,
        });
        router.push('/change-password');
        return;
      }
      router.push('/app');
    } catch (err: unknown) {
      const message = resolveError(err);
      setError(message);
      setErrorKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ─── Painel institucional (esquerda) — continuação da landing ─── */}
      <aside className="relative hidden w-[52%] flex-col justify-between p-12 lg:flex xl:p-16">
        {/* Topo: wordmark oficial com glow respirando atrás (o A é o símbolo da marca) */}
        <div className="relative w-fit duration-deliberate animate-in fade-in slide-in-from-top-2">
          <div
            aria-hidden
            className="animate-avecchi-breathe absolute -inset-x-14 -inset-y-8 rounded-full blur-2xl"
            style={{
              background:
                'radial-gradient(ellipse 70% 80% at 40% 50%, rgba(61,44,230,0.30) 0%, rgba(0,194,168,0.06) 60%, transparent 100%)',
            }}
          />
          <AvecchiWordmark animated className="relative text-[32px]" />
        </div>

        {/* Centro: a marca, não as features — hierarquia com bastante respiro */}
        <div className="space-y-10">
          <h2
            className="max-w-[24rem] text-[34px] font-semibold leading-[1.18] tracking-tight text-white duration-deliberate animate-in fade-in slide-in-from-bottom-3"
            style={{ animationDelay: '120ms', animationFillMode: 'backwards' }}
          >
            Conectando pessoas, processos e resultados.
          </h2>

          <div className="space-y-2.5 text-[17px] font-light leading-snug">
            {[
              ['Mais controle.', 'text-white/45'],
              ['Menos complexidade.', 'text-white/45'],
              ['Mais crescimento.', 'text-white/85'],
            ].map(([line, tone], i) => (
              <p
                key={line}
                className={`${tone} duration-deliberate animate-in fade-in slide-in-from-bottom-2`}
                style={{ animationDelay: `${340 + i * 140}ms`, animationFillMode: 'backwards' }}
              >
                {line}
              </p>
            ))}
          </div>
        </div>

        {/* Rodapé */}
        <p className="text-[12px] font-light tracking-wide text-white/35">
          © {new Date().getFullYear()} Avecchi ·{' '}
          <a
            href="https://avecchi.ai"
            className="underline-offset-4 transition-colors hover:text-white/60 hover:underline"
          >
            avecchi.ai
          </a>
        </p>
      </aside>

      {/* ─── Formulário (direita) ─── */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">
          {/* Marca no mobile/tablet (o painel institucional está oculto) */}
          <div className="relative mx-auto mb-10 w-fit duration-deliberate animate-in fade-in slide-in-from-top-2 lg:hidden">
            <div
              aria-hidden
              className="animate-avecchi-breathe absolute -inset-x-12 -inset-y-7 rounded-full blur-2xl"
              style={{
                background:
                  'radial-gradient(ellipse 70% 80% at 50% 50%, rgba(61,44,230,0.30) 0%, rgba(0,194,168,0.06) 60%, transparent 100%)',
              }}
            />
            <AvecchiWordmark animated className="relative text-[28px]" />
          </div>

          <div
            className="relative rounded-2xl border border-white/[0.12] bg-white/[0.07] p-8 shadow-[0_32px_80px_-24px_rgb(0_0_0/0.55)] backdrop-blur-2xl duration-deliberate animate-in fade-in slide-in-from-bottom-2"
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
            <div className="mb-7">
              <h1 className="text-[22px] font-semibold tracking-tight text-white">
                Bem-vindo de volta
              </h1>
              <p className="mt-1.5 text-sm font-light text-white/55">
                Acesse sua conta para continuar.
              </p>
            </div>

            {notice === 'password-changed' && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#00C2A8]/25 bg-[#00C2A8]/10 px-3 py-2.5 text-[13px] text-[#5eead4]">
                <CheckCircle2 size={16} className="mt-px shrink-0" />
                <span>Senha definida com sucesso! Entre com a sua nova senha.</span>
              </div>
            )}
            {notice === 'password-change-expired' && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-[13px] text-amber-200">
                <AlertCircle size={16} className="mt-px shrink-0" />
                <span>
                  O prazo para definir a nova senha expirou. Entre de novo com a senha
                  provisória para recomeçar.
                </span>
              </div>
            )}
            {notice === 'expired' && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2.5 text-[13px] text-amber-200">
                <AlertCircle size={16} className="mt-px shrink-0" />
                <span>Sua sessão expirou. Faça login novamente para continuar.</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <Label htmlFor="email" className="text-[13px] text-white/70">
                  E-mail
                </Label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-white/30"
                  />
                  <Input
                    id="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    error={!!error}
                    required
                    className="border-white/10 bg-white/[0.05] pl-9 text-white placeholder:text-white/25 hover:border-white/20 focus:border-[#818CF8]/60"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="password" className="text-[13px] text-white/70">
                  Senha
                </Label>
                <div className="relative">
                  <Lock
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-white/30"
                  />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    error={!!error}
                    required
                    className="border-white/10 bg-white/[0.05] px-9 text-white placeholder:text-white/25 hover:border-white/20 focus:border-[#818CF8]/60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-md p-1.5 text-white/30 transition-colors hover:text-white"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <label className="flex w-fit cursor-pointer items-center gap-2 text-[13px] text-white/55 transition-colors hover:text-white/80">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 accent-[#3D2CE6]"
                />
                Lembrar-me
              </label>

              {error && (
                <div
                  key={errorKey}
                  role="alert"
                  className="flex animate-shake items-start gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2.5 text-[13px] text-red-300"
                >
                  <AlertCircle size={16} className="mt-px shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                size="lg"
                loading={loading}
                className="w-full transition-all duration-300 shadow-[0_0_20px_rgba(61,44,230,0.35)] hover:shadow-[0_0_32px_rgba(61,44,230,0.5),0_4px_24px_rgba(0,194,168,0.15)] focus-visible:ring-offset-black"
              >
                {loading ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </div>

          {/* Reset de senha é feito pelo administrador (#468) — sem fluxo self-service */}
          <p className="mt-6 text-center text-[12px] font-light leading-relaxed text-white/35">
            Esqueceu a senha ou precisa de acesso?
            <br />
            Fale com o administrador da sua empresa.
          </p>
        </div>
      </main>
    </div>
  );
}

/** Traduz o erro do login em mensagem amigável (credenciais × servidor fora). */
function resolveError(err: unknown): string {
  const e = err as { response?: { status?: number }; code?: string; message?: string };
  // Sem resposta do servidor → rede/indisponível
  if (e?.code === 'ERR_NETWORK' || (e?.message && /network/i.test(e.message))) {
    return 'Servidor indisponível no momento. Tente novamente em instantes.';
  }
  const status = e?.response?.status;
  if (status === 401 || status === 400) return 'E-mail ou senha incorretos.';
  if (status && status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
  return e?.message ?? 'Não foi possível entrar. Verifique suas credenciais.';
}
