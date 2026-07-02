'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Boxes,
  Eye,
  EyeOff,
  Factory,
  Lock,
  Mail,
  ScrollText,
  Wallet,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const REMEMBER_KEY = 'avequi:remember-email';

const FEATURES = [
  { icon: Factory, label: 'Produção' },
  { icon: Boxes, label: 'Estoque' },
  { icon: ScrollText, label: 'Fiscal' },
  { icon: Wallet, label: 'Financeiro' },
] as const;

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
  const [sessionExpired, setSessionExpired] = useState(false);

  // Carrega e-mail lembrado + detecta sessão expirada (?reason=expired).
  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_KEY);
    if (saved) {
      setEmail(saved);
      setRemember(true);
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'expired') setSessionExpired(true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSessionExpired(false);
    try {
      await login(email, password);
      if (remember) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);
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
    <div className="flex min-h-screen bg-surface-secondary">
      {/* ─── Painel de branding (esquerda, 55%) — oculto no mobile ─── */}
      <aside className="relative hidden w-[55%] flex-col justify-between overflow-hidden bg-brand-950 p-12 text-white md:flex lg:w-[55%]">
        {/* Pattern sutil de grid */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        {/* Glow do gradiente da marca */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #3D2CE6 0%, transparent 70%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full opacity-20 blur-3xl"
          style={{ background: 'radial-gradient(circle, #00C2A8 0%, transparent 70%)' }}
        />

        {/* Topo: marca */}
        <div className="relative flex items-center gap-3 duration-deliberate animate-in fade-in slide-in-from-top-2">
          <BrandMark size={36} />
          <span className="text-2xl font-semibold tracking-tight">Avequi</span>
        </div>

        {/* Centro: tagline + features */}
        <div className="relative space-y-8">
          <div className="space-y-3 duration-deliberate animate-in fade-in slide-in-from-bottom-3">
            <h2 className="max-w-md text-display font-semibold leading-tight">
              Gestão industrial inteligente
            </h2>
            <p className="max-w-sm text-subtitle text-white/70">
              Do chão de fábrica ao fiscal, num só lugar. O ERP da GDR Reboques.
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {FEATURES.map(({ icon: Icon, label }, i) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-caption backdrop-blur duration-deliberate animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${120 + i * 70}ms`, animationFillMode: 'backwards' }}
              >
                <Icon size={15} className="text-accent" />
                {label}
              </div>
            ))}
          </div>
        </div>

        {/* Rodapé */}
        <p className="relative text-helper text-white/40">
          © {new Date().getFullYear()} Avequi · GDR Reboques
        </p>
      </aside>

      {/* ─── Painel de login (direita, 45%) ─── */}
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm duration-deliberate animate-in fade-in slide-in-from-bottom-2">
          {/* Marca (visível no mobile e como reforço no desktop) */}
          <div className="mb-8 flex items-center gap-2.5">
            <BrandMark size={28} />
            <span className="text-title font-semibold tracking-tight text-content">Avequi</span>
          </div>

          <div className="mb-6">
            <h1 className="text-heading text-content">Acesse sua conta</h1>
            <p className="mt-1 text-body text-content-secondary">
              Entre com suas credenciais para continuar.
            </p>
          </div>

          {sessionExpired && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2.5 text-caption text-warning-800 dark:border-warning-900 dark:bg-warning-900/20 dark:text-warning-300">
              <AlertCircle size={16} className="mt-px shrink-0" />
              <span>Sua sessão expirou. Faça login novamente para continuar.</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="email" className="dark:text-content-secondary">
                E-mail
              </Label>
              <div className="relative">
                <Mail
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
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
                  className="pl-9 dark:bg-surface-elevated dark:text-content dark:placeholder:text-content-muted"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="password" className="dark:text-content-secondary">
                Senha
              </Label>
              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
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
                  className="px-9 dark:bg-surface-elevated dark:text-content dark:placeholder:text-content-muted"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-content-muted transition-colors hover:text-content"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2 text-caption text-content-secondary">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="h-4 w-4 rounded border-line text-brand-600 dark:text-brand-400 accent-brand-600 focus-ring"
                />
                Lembrar-me
              </label>
              <a
                href="#"
                className="text-caption font-medium text-brand-600 dark:text-brand-400 transition-colors hover:text-brand-700 dark:hover:text-brand-300 dark:text-brand-400 dark:hover:text-brand-300"
              >
                Esqueci minha senha
              </a>
            </div>

            {error && (
              <div
                key={errorKey}
                role="alert"
                className="flex animate-shake items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-caption text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-300"
              >
                <AlertCircle size={16} className="mt-px shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" size="lg" loading={loading} className="w-full">
              {loading ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
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
