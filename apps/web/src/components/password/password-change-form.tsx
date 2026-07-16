'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { resolveChangePasswordError } from '@/lib/password-change';
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
 * Formulário compartilhado de troca de senha (#735/#736).
 *
 * Dois modos, espelhando as DUAS credenciais que o POST /auth/change-password
 * aceita (#345):
 * - `forced`: primeiro acesso / senha vencida — autentica com o
 *   passwordChangeToken restrito no body (o guard global rejeitaria esse
 *   token no header; a rota é @Public e valida no service);
 * - `voluntary`: usuário logado — Bearer normal no header + senha atual
 *   reconfirmada no body.
 *
 * A validação REAL de complexidade/histórico é do backend (mensagens PT-BR
 * exibidas como vêm); aqui só o óbvio: confirmação igual e tamanho mínimo.
 */
export function PasswordChangeForm({
  mode,
  passwordChangeToken,
  submitLabel,
  onSuccess,
  onRestrictedTokenRejected,
}: {
  mode: 'forced' | 'voluntary';
  /** Obrigatório no modo forced. */
  passwordChangeToken?: string;
  submitLabel: string;
  onSuccess: (newPassword: string) => void | Promise<void>;
  /**
   * Modo forced: chamado quando o backend rejeita o passwordChangeToken
   * (401 — inválido/expirado). Retentar é inútil; o dono do fluxo limpa o
   * handoff e devolve o usuário ao login.
   */
  onRestrictedTokenRejected?: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Endpoint público (#345) — orienta o usuário ANTES do primeiro 400.
  const { data: policy } = useQuery<PasswordPolicy>({
    queryKey: ['password-policy'],
    queryFn: async () => (await apiClient.get('/auth/password-policy')).data,
    staleTime: Infinity,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    const minLength = policy?.minLength ?? 10;
    if (newPassword.length < minLength) {
      setError(`A nova senha precisa de pelo menos ${minLength} caracteres.`);
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(
        '/auth/change-password',
        mode === 'forced'
          ? { passwordChangeToken, newPassword }
          : { currentPassword, newPassword },
      );
      await onSuccess(newPassword);
    } catch (err) {
      // Token restrito rejeitado (forced): sem retry possível — devolve o
      // controle ao dono do fluxo (limpa handoff + volta ao login).
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (mode === 'forced' && status === 401 && onRestrictedTokenRejected) {
        onRestrictedTokenRejected();
        return;
      }
      setError(resolveChangePasswordError(err));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {policy?.description && (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2.5 text-caption text-content-secondary">
          <ShieldCheck size={16} className="mt-px shrink-0 text-content-muted" />
          <span>{policy.description}</span>
        </div>
      )}

      {mode === 'voluntary' && (
        <PasswordField
          id="current-password"
          label="Senha atual"
          autoComplete="current-password"
          value={currentPassword}
          onChange={setCurrentPassword}
          show={showPasswords}
          error={!!error}
        />
      )}

      <PasswordField
        id="new-password"
        label="Nova senha"
        autoComplete="new-password"
        value={newPassword}
        onChange={setNewPassword}
        show={showPasswords}
        error={!!error}
        onToggleShow={() => setShowPasswords((v) => !v)}
      />

      <PasswordField
        id="confirm-password"
        label="Confirmar nova senha"
        autoComplete="new-password"
        value={confirmPassword}
        onChange={setConfirmPassword}
        show={showPasswords}
        error={!!error}
      />

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 whitespace-pre-line rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-caption text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-300"
        >
          <AlertCircle size={16} className="mt-px shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" size="lg" loading={loading} className="w-full">
        {loading ? 'Salvando…' : submitLabel}
      </Button>
    </form>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  show,
  error,
  onToggleShow,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  error: boolean;
  /** Presente só no campo que carrega o botão olho (controla os 3 juntos). */
  onToggleShow?: () => void;
}) {
  return (
    <div>
      <Label htmlFor={id} className="dark:text-content-secondary">
        {label}
      </Label>
      <div className="relative">
        <Lock
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
        />
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="••••••••"
          error={error}
          required
          className="px-9 dark:bg-surface-elevated dark:text-content dark:placeholder:text-content-muted"
        />
        {onToggleShow && (
          <button
            type="button"
            onClick={onToggleShow}
            tabIndex={-1}
            aria-label={show ? 'Ocultar senhas' : 'Mostrar senhas'}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-content-muted transition-colors hover:text-content"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
