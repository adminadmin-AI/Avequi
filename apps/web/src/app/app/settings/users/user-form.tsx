'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { UserRole } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ROLE_OPTIONS } from './roles';

const ROLES = ROLE_OPTIONS.map((r) => r.value) as [UserRole, ...UserRole[]];

const baseSchema = z.object({
  name: z.string().min(1, 'Informe o nome'),
  email: z.string().email('E-mail inválido'),
  role: z.enum(ROLES),
  password: z.string().optional(),
});

export type UserFormValues = z.infer<typeof baseSchema>;

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function UserForm({
  formId,
  isEdit,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  isEdit: boolean;
  defaultValues?: Partial<UserFormValues>;
  onSubmit: (values: UserFormValues) => void;
}) {
  // No cadastro a senha inicial é obrigatória; na edição o e-mail é imutável
  // e a senha fica em branco (só é enviada se preenchida).
  const schema = isEdit
    ? baseSchema
    : baseSchema.extend({
        password: z.string().min(6, 'Mínimo de 6 caracteres'),
      });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { role: 'READER', ...defaultValues },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Nome completo" />
      </Field>

      <Field label="E-mail" required error={errors.email?.message}>
        <Input
          {...register('email')}
          type="email"
          error={!!errors.email}
          disabled={isEdit}
          placeholder="usuario@gdr.com.br"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Papel" required error={errors.role?.message}>
          <Select {...register('role')} error={!!errors.role}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        {!isEdit && (
          <Field label="Senha inicial" required error={errors.password?.message}>
            <Input
              {...register('password')}
              type="password"
              error={!!errors.password}
              placeholder="••••••"
              autoComplete="new-password"
            />
          </Field>
        )}
      </div>
    </form>
  );
}
