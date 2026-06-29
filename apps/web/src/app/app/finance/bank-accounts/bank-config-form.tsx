'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/**
 * Configuração de cobrança/integração de uma conta bancária
 * (PATCH /banking/accounts/:id/configure). Todos os campos são opcionais —
 * o backend só atualiza os que forem enviados.
 */
const schema = z.object({
  provider: z.string().optional(),
  pixKey: z.string().optional(),
  minCashBalance: z
    .union([z.coerce.number().min(0, 'Não pode ser negativo'), z.literal('')])
    .optional(),
});

export type BankConfigFormValues = z.infer<typeof schema>;

const PROVIDERS = ['MANUAL', 'INTER', 'SICOOB', 'BRADESCO', 'ITAU', 'SANTANDER', 'BB'];

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function BankConfigForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<BankConfigFormValues>;
  onSubmit: (values: BankConfigFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BankConfigFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      <Field label="Provider (integração bancária)" hint="Banco/serviço usado para boleto e PIX.">
        <Select {...register('provider')}>
          <option value="">— Não configurado —</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Chave PIX" error={errors.pixKey?.message}>
        <Input {...register('pixKey')} placeholder="CNPJ, e-mail, telefone ou aleatória" />
      </Field>
      <Field
        label="Saldo mínimo de caixa"
        error={errors.minCashBalance?.message as string | undefined}
        hint="Alerta quando o saldo cair abaixo deste valor."
      >
        <Input
          type="number"
          step="0.01"
          min="0"
          {...register('minCashBalance')}
          placeholder="0,00"
          className="font-mono"
        />
      </Field>
    </form>
  );
}
