'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Eye, EyeOff, Info, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useUpdate } from '@/hooks/use-resource';
import type { User } from '@/types/api';
import { FormDialog } from '@/components/ui/form-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { resolveApiError } from './resolve-api-error';

interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  historySize: number;
  description: string;
}

const FORM_ID = 'reset-password-form';

/**
 * Redefinição de senha pelo admin (#750).
 *
 * Reusa o PATCH /users/:id { password } que já existe desde o #468: o
 * backend valida a política completa (complexidade, nome/e-mail, histórico),
 * re-hasheia e liga mustChangePassword=true — o usuário cai na tela de troca
 * obrigatória (#743) no próximo login. Aqui só o óbvio (confirmação igual e
 * tamanho mínimo); as mensagens PT-BR da política são exibidas como vêm.
 */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toast = useToast();
  // O tipo User não expõe password (e nunca deve) — o input é declarado à parte.
  const update = useUpdate<User, { password: string }>('/users');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');

  // Endpoint público (#345) — orienta o admin ANTES do primeiro 400.
  const { data: policy } = useQuery<PasswordPolicy>({
    queryKey: ['password-policy'],
    queryFn: async () => (await apiClient.get('/auth/password-policy')).data,
    staleTime: Infinity,
  });

  function handleOpenChange(next: boolean) {
    if (!next) {
      setPassword('');
      setConfirm('');
      setShow(false);
      setError('');
    }
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }
    const minLength = policy?.minLength ?? 10;
    if (password.length < minLength) {
      setError(`A nova senha precisa de pelo menos ${minLength} caracteres.`);
      return;
    }
    if (!user) return;

    update.mutate(
      { id: user.id, data: { password } },
      {
        onSuccess: () => {
          toast.success('Senha redefinida. O usuário deverá trocá-la no próximo login.');
          handleOpenChange(false);
        },
        onError: (err) =>
          setError(resolveApiError(err, 'Não conseguimos redefinir a senha. Tente de novo.')),
      },
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Redefinir senha"
      description={user ? `Nova senha provisória para "${user.name}"` : undefined}
      formId={FORM_ID}
      submitLabel="Redefinir senha"
      loading={update.isPending}
      dirty={!!password || !!confirm}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4 py-1" noValidate>
        {policy?.description && (
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2.5 text-caption text-content-secondary">
            <ShieldCheck size={16} className="mt-px shrink-0 text-content-muted" />
            <span>{policy.description}</span>
          </div>
        )}

        <Field label="Nova senha provisória" required>
          <div className="relative">
            <Input
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              error={!!error}
              required
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              tabIndex={-1}
              aria-label={show ? 'Ocultar senhas' : 'Mostrar senhas'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-content-muted transition-colors hover:text-content"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>

        <Field label="Confirmar nova senha" required>
          <Input
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            error={!!error}
            required
          />
        </Field>

        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-secondary px-3 py-2.5 text-caption text-content-secondary">
          <Info size={16} className="mt-px shrink-0 text-content-muted" />
          <span>
            O usuário será obrigado a trocar esta senha no próximo login (troca
            obrigatória).
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 whitespace-pre-line rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-caption text-danger-700 dark:border-danger-900 dark:bg-danger-900/20 dark:text-danger-300"
          >
            <AlertCircle size={16} className="mt-px shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>
    </FormDialog>
  );
}
