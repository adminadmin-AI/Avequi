'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { IamDepartment, User } from '@/types/api';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/**
 * Formulários da estrutura organizacional (#347 F5.2, fase 1):
 * filial, departamento e equipe. Mesmo padrão do warehouse-form
 * (react-hook-form + zod, submit externo via formId do FormDialog).
 */

const CODE_REGEX = /^[A-Za-z][A-Za-z0-9_-]*$/;

// ─── Filial ───────────────────────────────────────────────────────────────────

const branchSchema = z.object({
  code: z
    .string()
    .min(2, 'Mínimo de 2 caracteres')
    .max(20, 'Máximo de 20 caracteres')
    .regex(CODE_REGEX, 'Use letras, números, hífen ou underscore (ex.: CWB)'),
  name: z.string().min(2, 'Informe o nome').max(80),
  cnpj: z.string().max(20).optional(),
});

export type BranchFormValues = z.infer<typeof branchSchema>;

export function BranchForm({
  formId,
  defaultValues,
  isEdit,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<BranchFormValues>;
  isEdit?: boolean;
  onSubmit: (values: BranchFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BranchFormValues>({
    resolver: zodResolver(branchSchema),
    defaultValues,
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-[1fr_2fr] gap-4">
        <Field label="Código" required error={errors.code?.message}>
          <Input
            {...register('code')}
            error={!!errors.code}
            placeholder="CWB"
            disabled={isEdit}
            title={isEdit ? 'O código não pode ser alterado' : undefined}
            className="font-mono uppercase"
          />
        </Field>
        <Field label="Nome" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Filial Curitiba" />
        </Field>
      </div>
      <Field label="CNPJ" error={errors.cnpj?.message}>
        <Input {...register('cnpj')} placeholder="00.000.000/0001-00 (opcional)" />
      </Field>
    </form>
  );
}

// ─── Departamento ─────────────────────────────────────────────────────────────

const departmentSchema = z.object({
  code: z
    .string()
    .min(2, 'Mínimo de 2 caracteres')
    .max(30, 'Máximo de 30 caracteres')
    .regex(CODE_REGEX, 'Use letras, números, hífen ou underscore (ex.: PRODUCAO)'),
  name: z.string().min(2, 'Informe o nome').max(80),
  parentId: z.string().optional(),
  managerId: z.string().optional(),
});

export type DepartmentFormValues = z.infer<typeof departmentSchema>;

export function DepartmentForm({
  formId,
  defaultValues,
  isEdit,
  editingId,
  departments,
  users,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<DepartmentFormValues>;
  isEdit?: boolean;
  /** ID do departamento em edição (excluído da lista de pais possíveis). */
  editingId?: string;
  departments: IamDepartment[];
  users: User[];
  onSubmit: (values: DepartmentFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DepartmentFormValues>({
    resolver: zodResolver(departmentSchema),
    defaultValues,
  });

  const parentOptions = departments.filter((d) => d.id !== editingId);

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <div className="grid grid-cols-[1fr_2fr] gap-4">
        <Field label="Código" required error={errors.code?.message}>
          <Input
            {...register('code')}
            error={!!errors.code}
            placeholder="PRODUCAO"
            disabled={isEdit}
            title={isEdit ? 'O código não pode ser alterado' : undefined}
            className="font-mono uppercase"
          />
        </Field>
        <Field label="Nome" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Produção" />
        </Field>
      </div>
      <Field label="Departamento pai (hierarquia)" error={errors.parentId?.message}>
        <Select {...register('parentId')}>
          <option value="">Nenhum (raiz)</option>
          {parentOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.code})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Gerente" error={errors.managerId?.message}>
        <Select {...register('managerId')}>
          <option value="">Sem gerente definido</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.email}
            </option>
          ))}
        </Select>
      </Field>
    </form>
  );
}

// ─── Equipe ───────────────────────────────────────────────────────────────────

const teamSchema = z.object({
  name: z.string().min(2, 'Informe o nome').max(80),
  departmentId: z.string().min(1, 'Selecione o departamento'),
  leaderId: z.string().optional(),
});

export type TeamFormValues = z.infer<typeof teamSchema>;

export function TeamForm({
  formId,
  defaultValues,
  departments,
  users,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<TeamFormValues>;
  departments: IamDepartment[];
  users: User[];
  onSubmit: (values: TeamFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TeamFormValues>({
    resolver: zodResolver(teamSchema),
    defaultValues,
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Nome" required error={errors.name?.message}>
        <Input {...register('name')} error={!!errors.name} placeholder="Turno A" />
      </Field>
      <Field label="Departamento" required error={errors.departmentId?.message}>
        <Select {...register('departmentId')} error={!!errors.departmentId}>
          <option value="">Selecione o departamento</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.code})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Líder" error={errors.leaderId?.message}>
        <Select {...register('leaderId')}>
          <option value="">Sem líder definido</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {u.email}
            </option>
          ))}
        </Select>
      </Field>
    </form>
  );
}
