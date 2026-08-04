'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, Lock, ShieldAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { resolveMfaError } from '@/lib/mfa';
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

const FORM_ID = 'mfa-disable-form';

/**
 * Desativar o MFA (#936) — espelha o contrato do backend: senha ATUAL + um
 * código válido (TOTP ou backup code). São dois fatores de propósito: quem
 * está com a sessão aberta de um usuário distraído não pode desligar o
 * segundo fator dele sozinho.
 *
 * O aviso não é decorativo: o console da operadora exige MFA ativo
 * (OpsMfaGuard). Quem é operador e desliga aqui perde o /app/ops na hora,
 * até reativar — melhor descobrir isso ANTES de clicar.
 */
export function DisableMfaDialog({
  open,
  onOpenChange,
  onDesativado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDesativado: () => void;
}) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Nada de senha/código sobrando em memória entre aberturas do diálogo.
  useEffect(() => {
    if (!open) {
      setPassword('');
      setCode('');
      setShow(false);
      setErro(null);
    }
  }, [open]);

  const desativar = useMutation({
    mutationFn: async (input: { password: string; code: string }) =>
      apiClient.post('/auth/mfa/disable', input),
    onSuccess: () => onDesativado(),
    onError: (err) =>
      setErro(resolveMfaError(err, 'Não foi possível desativar. Confira a senha e o código.')),
  });

  const podeEnviar = password.length > 0 && code.trim().length >= 6;

  return (
    <Dialog open={open} onOpenChange={(v) => !desativar.isPending && onOpenChange(v)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Desativar verificação em duas etapas</DialogTitle>
          <DialogDescription>
            Sua conta volta a ser protegida só pela senha.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            id={FORM_ID}
            className="space-y-4 pb-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!podeEnviar || desativar.isPending) return;
              setErro(null);
              desativar.mutate({ password, code: code.trim() });
            }}
          >
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <ShieldAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                O portal da operadora exige MFA ativo. Se você é operador da Avecchi, perde o acesso
                ao console assim que desativar — só volta reativando aqui.
              </span>
            </p>

            <div>
              <Label htmlFor="mfa-disable-password">Sua senha atual</Label>
              <div className="relative">
                <Lock
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-muted"
                />
                <Input
                  id="mfa-disable-password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (erro) setErro(null);
                  }}
                  placeholder="••••••••"
                  error={!!erro}
                  required
                  className="px-9"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  tabIndex={-1}
                  aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-content-muted transition-colors duration-micro hover:text-content"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <Label htmlFor="mfa-disable-code">Código do autenticador ou backup code</Label>
              <Input
                id="mfa-disable-code"
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (erro) setErro(null);
                }}
                placeholder="000000"
                error={!!erro}
                required
                maxLength={9 /* TOTP (6) ou backup code xxxx-xxxx (9) */}
                helperText="Perdeu o celular? Use um dos seus backup codes."
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
            disabled={desativar.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="danger"
            loading={desativar.isPending}
            disabled={!podeEnviar}
          >
            Desativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
