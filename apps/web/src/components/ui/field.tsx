import { Label } from './label';

/**
 * Field — F10.2 (#332): label + controle + erro inline.
 *
 * Extraído de 14 cópias idênticas espalhadas pelos formulários (dedupe).
 * Uso:
 *   <Field label="Nome" required error={errors.name?.message}>
 *     <Input {...register('name')} error={!!errors.name} />
 *   </Field>
 */
export function Field({
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
