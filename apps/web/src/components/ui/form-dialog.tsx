'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** id do <form> que será submetido pelo botão de confirmar */
  formId: string;
  submitLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  className?: string;
}

/**
 * Wrapper de modal para formulários com react-hook-form.
 *
 * O conteúdo deve incluir um <form id={formId} onSubmit={handleSubmit(...)}>.
 * O botão de confirmar usa `form={formId}` para disparar o submit nativo.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  formId,
  submitLabel = 'Salvar',
  cancelLabel = 'Cancelar',
  loading,
  className,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-2">{children}</div>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button type="submit" form={formId} loading={loading}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
