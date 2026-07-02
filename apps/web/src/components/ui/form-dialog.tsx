'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  type DialogSize,
} from './dialog';
import { Button } from './button';
import { useConfirm } from './confirm-dialog';

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
  /** Largura do modal: sm (400) · md (500, default) · lg (640) · xl (800) · full (90vw) */
  size?: DialogSize;
  /**
   * Formulário com alterações não salvas (ex.: formState.isDirty do
   * react-hook-form). Quando true, fechar o modal (Esc, clique fora ou
   * Cancelar) pede confirmação antes de descartar.
   */
  dirty?: boolean;
  className?: string;
}

/**
 * Wrapper de modal para formulários com react-hook-form — F2.5 (#311).
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
  size = 'md',
  dirty,
  className,
}: FormDialogProps) {
  const confirm = useConfirm();

  async function handleOpenChange(next: boolean) {
    if (!next && dirty) {
      const ok = await confirm({
        title: 'Descartar alterações?',
        description: 'Existem alterações não salvas. Se fechar agora, elas serão perdidas.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Continuar editando',
        variant: 'danger',
      });
      if (!ok) return;
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size={size} className={className}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <DialogBody>{children}</DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => handleOpenChange(false)}
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
