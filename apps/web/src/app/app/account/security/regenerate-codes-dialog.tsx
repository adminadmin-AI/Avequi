'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { resolveMfaError } from '@/lib/mfa';
import type { MfaBackupCodes } from '@/types/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InlineMessage } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';

const FORM_ID = 'mfa-regenerate-form';

/**
 * Regerar os backup codes (#936). Exige um código MFA válido — o backend
 * confirma que quem pede está mesmo com o segundo fator na mão.
 *
 * A consequência precisa estar na cara ANTES de confirmar: a lista antiga
 * para de valer no mesmo instante. Quem imprimiu/guardou os códigos antigos
 * fica com papel sem valor, e só descobriria no pior momento possível.
 */
export function RegenerateCodesDialog({
  open,
  onOpenChange,
  onGerado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGerado: (codes: string[]) => void;
}) {
  const [code, setCode] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCode('');
      setErro(null);
    }
  }, [open]);

  const regenerar = useMutation({
    mutationFn: async (codigo: string) =>
      (
        await apiClient.post<MfaBackupCodes>('/auth/mfa/backup-codes/regenerate', {
          code: codigo,
        })
      ).data,
    onSuccess: (data) => onGerado(data.backupCodes ?? []),
    onError: (err) =>
      setErro(resolveMfaError(err, 'Não foi possível gerar novos códigos. Tente de novo.')),
  });

  const podeEnviar = code.trim().length >= 6;

  return (
    <Dialog open={open} onOpenChange={(v) => !regenerar.isPending && onOpenChange(v)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Gerar novos backup codes</DialogTitle>
          <DialogDescription>
            Você recebe 10 códigos novos e vê todos uma única vez.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            id={FORM_ID}
            className="space-y-4 pb-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!podeEnviar || regenerar.isPending) return;
              setErro(null);
              regenerar.mutate(code.trim());
            }}
          >
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <RefreshCw size={14} className="mt-0.5 shrink-0" />
              <span>
                Os backup codes atuais deixam de funcionar na hora. Se você guardou a lista antiga
                em algum lugar, troque por esta.
              </span>
            </p>

            <div>
              <Label htmlFor="mfa-regen-code">Código do autenticador ou backup code</Label>
              <Input
                id="mfa-regen-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (erro) setErro(null);
                }}
                placeholder="000000"
                error={!!erro}
                required
                maxLength={9 /* TOTP (6) ou backup code xxxx-xxxx (9) */}
              />
            </div>

            {erro && <InlineMessage variant="danger">{erro}</InlineMessage>}
          </form>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={regenerar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            loading={regenerar.isPending}
            disabled={!podeEnviar}
          >
            Gerar novos códigos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
