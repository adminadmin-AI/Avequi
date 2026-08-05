'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';

const UF = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
  'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
];

export const TAX_OPERATION_LABELS: Record<string, string> = {
  VENDA_INTERNA: 'Venda interna',
  VENDA_INTERESTADUAL: 'Venda interestadual',
  DEVOLUCAO_VENDA: 'Devolução de venda',
  TRANSFERENCIA_INTERNA: 'Transferência interna',
  TRANSFERENCIA_INTERESTADUAL: 'Transferência interestadual',
  COMPRA_INTERNA: 'Compra interna',
  COMPRA_INTERESTADUAL: 'Compra interestadual',
  DEVOLUCAO_COMPRA: 'Devolução de compra',
  REMESSA_CONSERTO: 'Remessa p/ conserto',
  RETORNO_CONSERTO: 'Retorno de conserto',
  AMOSTRA_GRATIS: 'Amostra grátis',
  BONIFICACAO: 'Bonificação',
  INDUSTRIALIZACAO: 'Industrialização',
};

const num = z
  .string()
  .optional()
  .refine((v) => !v || !Number.isNaN(Number(v)), 'Número inválido');

const schema = z.object({
  operationType: z.string().min(1, 'Informe a operação'),
  ncm: z.string().optional(),
  ufOrigem: z.string().optional(),
  ufDestino: z.string().optional(),
  cfop: z.string().min(4, 'CFOP tem 4 dígitos').max(4),
  // ICMS
  icmsCst: z.string().min(2, 'Informe o CST'),
  icmsAliquota: num,
  icmsBaseReducao: num,
  // IPI / PIS / COFINS
  ipiCst: z.string().optional(),
  ipiAliquota: num,
  pisCst: z.string().optional(),
  pisAliquota: num,
  cofinsCst: z.string().optional(),
  cofinsAliquota: num,
  // DIFAL / FCP
  icmsInternaDestino: num,
  fcpAliquotaDestino: num,
  // IBS/CBS (reforma)
  cClassTrib: z.string().optional(),
  cbsCst: z.string().optional(),
  cbsAliquota: num,
  ibsUfCst: z.string().optional(),
  ibsUfAliquota: num,
  ibsMunCst: z.string().optional(),
  ibsMunAliquota: num,
  // Vigência (#500) e meta
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  priority: num,
  description: z.string().optional(),
});

export type TaxRuleFormValues = z.infer<typeof schema>;

export function TaxRuleForm({
  formId,
  defaultValues,
  onSubmit,
}: {
  formId: string;
  defaultValues?: Partial<TaxRuleFormValues>;
  onSubmit: (values: TaxRuleFormValues) => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TaxRuleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { operationType: 'VENDA_INTERNA', icmsCst: '00', ...defaultValues },
  });

  return (
    <form id={formId} onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
      {/* ─── Escopo da regra ─── */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Operação" required error={errors.operationType?.message}>
          <Select {...register('operationType')} error={!!errors.operationType}>
            {Object.entries(TAX_OPERATION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="CFOP" required error={errors.cfop?.message}>
          <Input {...register('cfop')} placeholder="5101" maxLength={4} error={!!errors.cfop} />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Field label="NCM (vazio = qualquer)" error={errors.ncm?.message}>
          <Input {...register('ncm')} placeholder="87163900" maxLength={8} />
        </Field>
        <Field label="UF origem (vazia = qualquer)">
          <Select {...register('ufOrigem')}>
            <option value="">Qualquer</option>
            {UF.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="UF destino (vazia = qualquer)">
          <Select {...register('ufDestino')}>
            <option value="">Qualquer</option>
            {UF.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* ─── ICMS ─── */}
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm font-medium text-content-secondary">ICMS</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="CST" required error={errors.icmsCst?.message}>
            <Input {...register('icmsCst')} placeholder="00" error={!!errors.icmsCst} />
          </Field>
          <Field label="Alíquota (%)" error={errors.icmsAliquota?.message}>
            <Input {...register('icmsAliquota')} type="number" step="0.01" placeholder="18" />
          </Field>
          <Field label="Base de cálculo (%)" error={errors.icmsBaseReducao?.message}>
            <Input {...register('icmsBaseReducao')} type="number" step="0.01" placeholder="100 = sem redução" />
          </Field>
        </div>
      </div>

      {/* ─── IPI / PIS / COFINS ─── */}
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm font-medium text-content-secondary">IPI · PIS · COFINS</p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="IPI CST">
            <Input {...register('ipiCst')} placeholder="99" />
          </Field>
          <Field label="PIS CST">
            <Input {...register('pisCst')} placeholder="01" />
          </Field>
          <Field label="COFINS CST">
            <Input {...register('cofinsCst')} placeholder="01" />
          </Field>
          <Field label="IPI alíquota (%)">
            <Input {...register('ipiAliquota')} type="number" step="0.01" placeholder="0" />
          </Field>
          <Field label="PIS alíquota (%)">
            <Input {...register('pisAliquota')} type="number" step="0.01" placeholder="0.65" />
          </Field>
          <Field label="COFINS alíquota (%)">
            <Input {...register('cofinsAliquota')} type="number" step="0.01" placeholder="3" />
          </Field>
        </div>
      </div>

      {/* ─── DIFAL / FCP ─── */}
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm font-medium text-content-secondary">
          DIFAL / FCP: vendas interestaduais a consumidor final
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Alíquota interna do UF destino (%)" error={errors.icmsInternaDestino?.message}>
            <Input {...register('icmsInternaDestino')} type="number" step="0.01" placeholder="Ex.: 18 (SP)" />
          </Field>
          <Field label="FCP do UF destino (%)" error={errors.fcpAliquotaDestino?.message}>
            <Input {...register('fcpAliquotaDestino')} type="number" step="0.01" placeholder="Ex.: 2 (SP/RJ)" />
          </Field>
        </div>
      </div>

      {/* ─── IBS/CBS — reforma tributária ─── */}
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm font-medium text-content-secondary">
          IBS/CBS: reforma tributária (NT 2025.002). Vazio = não emite grupo UB.
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="cClassTrib">
            <Input {...register('cClassTrib')} placeholder="000001" maxLength={6} />
          </Field>
          <Field label="CBS CST">
            <Input {...register('cbsCst')} placeholder="000" maxLength={3} />
          </Field>
          <Field label="CBS alíquota (%)">
            <Input {...register('cbsAliquota')} type="number" step="0.0001" placeholder="0.9" />
          </Field>
          <Field label="IBS UF CST">
            <Input {...register('ibsUfCst')} placeholder="000" maxLength={3} />
          </Field>
          <Field label="IBS UF alíquota (%)">
            <Input {...register('ibsUfAliquota')} type="number" step="0.0001" placeholder="0.1" />
          </Field>
          <Field label="IBS Mun alíquota (%)">
            <Input {...register('ibsMunAliquota')} type="number" step="0.0001" placeholder="0" />
          </Field>
        </div>
      </div>

      {/* ─── Vigência (#500) e meta ─── */}
      <div className="border-t border-line pt-4">
        <p className="mb-3 text-sm font-medium text-content-secondary">
          Vigência: NT nova ou fase da reforma = regra nova com início futuro
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Válida desde (vazio = sempre)">
            <Input {...register('validFrom')} type="date" />
          </Field>
          <Field label="Válida até (vazio = sem fim)">
            <Input {...register('validTo')} type="date" />
          </Field>
          <Field label="Prioridade (maior = mais específica)" error={errors.priority?.message}>
            <Input {...register('priority')} type="number" placeholder="0" />
          </Field>
        </div>
        <Field label="Descrição">
          <Input {...register('description')} placeholder="Ex.: Venda interna PR padrão (reboques)" />
        </Field>
      </div>
    </form>
  );
}
