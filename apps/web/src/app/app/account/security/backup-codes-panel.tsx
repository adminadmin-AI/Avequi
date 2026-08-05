'use client';

import { useState } from 'react';
import { Check, Copy, Download, KeyRound, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useAuthStore } from '@/stores/auth-store';
import { arquivoDeBackupCodes, backupCodesParaClipboard } from '@/lib/mfa';

/**
 * Exibição ÚNICA dos backup codes (#936) — usada tanto no fim da ativação
 * quanto depois de regenerar.
 *
 * Regra que desenha esta tela: o backend guarda só o hash dos códigos. Se o
 * usuário fechar aqui sem levar os códigos, eles somem para sempre e a única
 * saída futura é um admin desligando o MFA dele. Por isso:
 *  - "Concluir" fica desabilitado até o usuário confirmar que guardou;
 *  - copiar e baixar são explícitos (o "baixar" marca a confirmação sozinho,
 *    porque aí o arquivo já está no disco dele).
 */
export function BackupCodesPanel({
  codes,
  titulo,
  descricao,
  onConcluir,
}: {
  codes: string[];
  titulo: string;
  descricao: string;
  onConcluir: () => void;
}) {
  const toast = useToast();
  const email = useAuthStore((s) => s.user?.email);
  const [guardou, setGuardou] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function copiarTodos() {
    try {
      await navigator.clipboard.writeText(backupCodesParaClipboard(codes));
      setCopiado(true);
      setGuardou(true);
      toast.success('Códigos copiados', 'Cole agora no seu gerenciador de senhas.');
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('Não foi possível copiar', 'Selecione os códigos e copie manualmente.');
    }
  }

  function baixarTxt() {
    const { filename, content } = arquivoDeBackupCodes(codes, { email, geradoEm: new Date() });
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setGuardou(true);
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-success/10 text-success">
          <KeyRound size={20} />
        </div>
        <h2 className="text-lg font-semibold text-content">{titulo}</h2>
        <p className="mt-1 text-sm text-content-secondary">{descricao}</p>
      </div>

      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4"
      >
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0 text-sm">
          <p className="font-medium text-content">Esta é a única vez que eles aparecem.</p>
          <p className="mt-1 text-content-secondary">
            Cada código funciona uma única vez, no lugar do código do autenticador. É o que salva
            você se perder o celular. Guarde antes de concluir: depois desta tela não há como vê-los
            de novo.
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-secondary p-4 sm:grid-cols-2">
        {codes.map((code, i) => (
          <li
            key={code}
            className="flex items-baseline gap-2 font-mono text-sm tracking-wide text-content"
          >
            <span className="w-5 shrink-0 text-right text-helper text-content-muted">{i + 1}</span>
            <span className="select-all">{code}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          leftIcon={copiado ? <Check size={16} /> : <Copy size={16} />}
          onClick={copiarTodos}
        >
          {copiado ? 'Copiado' : 'Copiar todos'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          leftIcon={<Download size={16} />}
          onClick={baixarTxt}
        >
          Baixar .txt
        </Button>
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-content-secondary">
        <input
          type="checkbox"
          checked={guardou}
          onChange={(e) => setGuardou(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line-strong text-brand-600 transition-colors duration-micro focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        />
        <span>Guardei meus backup codes em local seguro.</span>
      </label>

      <div className="flex justify-end border-t border-line pt-4">
        <Button type="button" disabled={!guardou} onClick={onConcluir}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
