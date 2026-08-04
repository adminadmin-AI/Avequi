'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Copy, QrCode, Smartphone } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { agruparSecret, resolveMfaError } from '@/lib/mfa';
import type { MfaBackupCodes, MfaSetup } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InlineMessage } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/**
 * QR do otpauth:// desenhado NO CLIENTE (#936).
 *
 * O segredo TOTP não pode virar querystring de um gerador de QR externo — é a
 * chave inteira do segundo fator viajando para terceiros. Por isso a lib
 * `qrcode` roda aqui mesmo, sem nenhuma chamada de rede, e entra por import
 * dinâmico para não pesar o bundle de quem só abre a tela para conferir o
 * estado do MFA.
 *
 * O quadrado fica branco nos dois temas de propósito: leitor de QR depende de
 * contraste escuro-sobre-claro, e um QR invertido no dark mode simplesmente
 * não é lido por parte dos apps.
 */
function QrDoOtpauth({ uri }: { uri: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let ativo = true;
    setDataUrl(null);
    setFalhou(false);
    import('qrcode')
      .then((m) =>
        m.toDataURL(uri, {
          width: 208,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#101828', light: '#ffffff' },
        }),
      )
      .then((url) => {
        if (ativo) setDataUrl(url);
      })
      .catch(() => {
        if (ativo) setFalhou(true);
      });
    return () => {
      ativo = false;
    };
  }, [uri]);

  if (falhou) {
    return (
      <div className="flex h-[208px] w-[208px] shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface-secondary p-4 text-center">
        <QrCode className="h-6 w-6 text-content-muted" />
        <p className="text-caption text-content-secondary">
          Não foi possível desenhar o QR. Use a chave abaixo para cadastrar manualmente.
        </p>
      </div>
    );
  }

  if (!dataUrl) return <Skeleton className="h-[208px] w-[208px] shrink-0 rounded-xl" />;

  return (
    <div className="shrink-0 rounded-xl border border-line bg-white p-3 shadow-xs">
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URI gerada no cliente, sem otimização do next/image */}
      <img src={dataUrl} alt="QR code para cadastrar a conta no app autenticador" width={208} height={208} />
    </div>
  );
}

/**
 * Etapa 1 da ativação (#936): cadastrar a conta no autenticador e provar que
 * deu certo com um código de 6 dígitos.
 *
 * QR e campo de código convivem na MESMA tela (em vez de dois passos do
 * stepper): o TOTP gira a cada 30s e é comum errar o primeiro; com o QR ainda
 * visível o usuário re-tenta — ou re-escaneia — sem navegar para trás.
 */
export function MfaSetupPanel({
  setup,
  onConfirmado,
  onCancelar,
}: {
  setup: MfaSetup;
  onConfirmado: (codes: string[]) => void;
  onCancelar: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const secretLegivel = agruparSecret(setup.secret);

  const confirmar = useMutation({
    mutationFn: async (codigo: string) =>
      (await apiClient.post<MfaBackupCodes>('/auth/mfa/confirm', { code: codigo })).data,
    onSuccess: (data) => onConfirmado(data.backupCodes ?? []),
    onError: (err) =>
      setErro(resolveMfaError(err, 'Não foi possível confirmar o código. Tente de novo.')),
  });

  async function copiarSecret() {
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopiado(true);
      toast.success('Chave copiada');
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('Não foi possível copiar', 'Selecione a chave e copie manualmente.');
    }
  }

  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const limpo = code.replace(/\s/g, '');
        if (limpo.length < 6 || confirmar.isPending) return;
        setErro(null);
        confirmar.mutate(limpo);
      }}
    >
      <div>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-600/15 dark:text-brand-300">
          <Smartphone size={20} />
        </div>
        <h2 className="text-lg font-semibold text-content">Cadastre a conta no autenticador</h2>
        <p className="mt-1 text-sm text-content-secondary">
          Abra seu app de autenticação (Google Authenticator, Microsoft Authenticator, 1Password,
          Authy…) e escaneie o QR abaixo.
        </p>
      </div>

      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <QrDoOtpauth uri={setup.otpauthUri} />

        <div className="min-w-0 flex-1 space-y-4">
          <div>
            <p className="text-caption font-medium text-content">Sem câmera? Digite a chave</p>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-surface-secondary px-3 py-2 font-mono text-sm tracking-wide text-content">
                {secretLegivel}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Copiar chave"
                onClick={copiarSecret}
              >
                {copiado ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
            <p className="mt-1.5 text-helper text-content-muted">
              Tipo de chave: por tempo (TOTP), 6 dígitos.
            </p>
          </div>

          <div>
            <Label htmlFor="mfa-setup-code">Código de 6 dígitos do app</Label>
            <Input
              id="mfa-setup-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ''));
                if (erro) setErro(null);
              }}
              error={!!erro}
              className="text-center text-lg tracking-[0.4em] placeholder:tracking-[0.4em]"
            />
            {erro && (
              <InlineMessage variant="danger" className="mt-2">
                {erro}
              </InlineMessage>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
        <Button type="button" variant="secondary" onClick={onCancelar} disabled={confirmar.isPending}>
          Cancelar
        </Button>
        <Button type="submit" loading={confirmar.isPending} disabled={code.length < 6}>
          Ativar verificação em duas etapas
        </Button>
      </div>
    </form>
  );
}
