'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { usePathname } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';

const schema = z.object({
  title: z.string().min(3, 'Descreva o problema em pelo menos 3 caracteres'),
  description: z.string().optional(),
});

export type IncidentFormValues = z.infer<typeof schema>;

/** Payload enviado ao POST /support/incidents — inclui contexto auto-capturado. */
export interface CreateIncidentPayload extends IncidentFormValues {
  route?: string;
  appVersion?: string;
}

/** Form de reporte de problema — self-service (épico #764). */
export function IncidentForm({
  formId,
  onSubmit,
}: {
  formId: string;
  onSubmit: (values: CreateIncidentPayload) => void;
}) {
  const pathname = usePathname();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<IncidentFormValues>({ resolver: zodResolver(schema) });

  function submit(values: IncidentFormValues) {
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    onSubmit({
      ...values,
      route: pathname ?? undefined,
      ...(appVersion ? { appVersion } : {}),
    });
  }

  return (
    <form id={formId} onSubmit={handleSubmit(submit)} className="space-y-4 py-1">
      <Field label="O que aconteceu?" required error={errors.title?.message}>
        <Input {...register('title')} error={!!errors.title} placeholder="Resuma o problema em poucas palavras" />
      </Field>

      <Field label="Detalhes (opcional)" error={errors.description?.message}>
        <Textarea
          {...register('description')}
          rows={5}
          error={!!errors.description}
          placeholder="Conte mais sobre o que estava fazendo quando o problema ocorreu..."
        />
      </Field>
    </form>
  );
}
