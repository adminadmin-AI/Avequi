'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { IamRole } from '@/types/api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

const schema = z.object({
  name: z.string().min(3, 'Mínimo de 3 caracteres'),
  description: z.string().optional(),
  copyFromRoleId: z.string().optional(),
});

export type RoleFormValues = z.infer<typeof schema>;

/**
 * Formulário de criação/edição de perfil personalizado (#352).
 * Na criação, permite escolher um perfil existente (system ou custom) como
 * ponto de partida — as permissões dele são copiadas ("duplicar perfil").
 */
export function RoleForm({
  formId,
  isEdit,
  roles,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  isEdit: boolean;
  roles: IamRole[];
  defaultValues?: Partial<RoleFormValues>;
  onSubmit: (values: RoleFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Nome do perfil" required error={errors.name?.message}>
        <Input
          {...register('name')}
          error={!!errors.name}
          placeholder="Ex.: Comprador Júnior"
        />
      </Field>

      <Field label="Descrição" error={errors.description?.message}>
        <Textarea
          {...register('description')}
          rows={3}
          placeholder="O que este perfil pode fazer e para quem ele é."
        />
      </Field>

      {!isEdit && (
        <Field label="Copiar permissões de (opcional)">
          <Select {...register('copyFromRoleId')} defaultValue="">
            <option value="">Começar do zero (sem permissões)</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.isSystem ? '(Sistema)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </form>
  );
}
