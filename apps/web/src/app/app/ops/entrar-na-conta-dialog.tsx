'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { mensagemDoErro } from '@/lib/api-error';
import * as impersonation from '@/lib/impersonation';
import type { ImpersonateResult, StartImpersonationInput, TenantHealth } from '@/types/api';
import { USER_ROLE_LABELS } from '@/lib/enums';
import { FormDialog } from '@/components/ui/form-dialog';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

const RESOURCE = '/ops/tenants';

/**
 * "Entrar no ERP" direto da LISTA de contas (OPS F2, pedido do Claudio):
 * um clique → escolhe o usuário do cliente + motivo → cai DENTRO do ERP do
 * cliente. Mesmo contrato do "Ver como" da aba Pessoas (WP6 #913): a entrada
 * é POR USUÁRIO (você vê exatamente o que ele vê), auditada, somente-leitura
 * e de 30 min — este diálogo só encurta o caminho, não afrouxa nada.
 *
 * Pré-seleção: o usuário ATIVO com login mais recente — na prática é quem o
 * cliente reportou o problema; trocar é um select.
 */
export function EntrarNaContaDialog({
  tenant,
  onClose,
}: {
  tenant: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const tooShort = reason.trim().length < 5;

  const healthQuery = useQuery<TenantHealth>({
    queryKey: [RESOURCE, tenant?.id, 'health'],
    queryFn: async () =>
      (await apiClient.get<TenantHealth>(`${RESOURCE}/${tenant?.id}/health`)).data,
    enabled: !!tenant,
  });

  const ativos = useMemo(
    () =>
      (healthQuery.data?.users ?? [])
        .filter((u) => u.isActive)
        .sort((a, b) => (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? '')),
    [healthQuery.data?.users],
  );

  // Pré-seleciona o login mais recente quando a lista chega (ou o diálogo
  // troca de conta); limpa o formulário ao fechar.
  useEffect(() => {
    if (!tenant) {
      setUserId('');
      setReason('');
      setTouched(false);
      return;
    }
    if (ativos.length > 0) setUserId((prev) => (prev ? prev : ativos[0].id));
  }, [tenant, ativos]);

  const entrar = useMutation({
    mutationFn: (input: StartImpersonationInput) =>
      apiClient.post<ImpersonateResult>(`${RESOURCE}/${tenant?.id}/impersonate`, input),
    onSuccess: (res) => {
      // Troca a sessão e navega para /app — o operador está DENTRO do ERP do
      // cliente (banner de sessão de suporte com countdown; o diálogo nem
      // chega a fechar "normalmente": a página já mudou).
      impersonation.start(res.data, tenant!.id);
    },
    onError: (err) =>
      toast.error(mensagemDoErro(err) ?? 'Não foi possível iniciar a sessão de suporte'),
  });

  return (
    <FormDialog
      open={!!tenant}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={tenant ? `Entrar no ERP de ${tenant.name}` : 'Entrar no ERP'}
      description="Sessão de suporte: você vê a conta exatamente como o usuário escolhido."
      formId="entrar-na-conta"
      submitLabel="Entrar"
      loading={entrar.isPending}
    >
      <form
        id="entrar-na-conta"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (tooShort || !userId || !tenant) return;
          entrar.mutate({ userId, reason: reason.trim() });
        }}
        className="space-y-4"
      >
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" />
          Sessão somente-leitura de 30 min, registrada e visível ao cliente.
        </p>

        <div>
          <Label htmlFor="entrar-usuario">Ver como o usuário</Label>
          {healthQuery.isLoading ? (
            <Skeleton className="h-10 w-full rounded-lg" />
          ) : ativos.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface-secondary px-3 py-2.5 text-sm text-content-muted">
              Nenhum usuário ativo nesta conta.
            </p>
          ) : (
            <Select
              id="entrar-usuario"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              {ativos.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {USER_ROLE_LABELS[u.role] ?? u.role}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="entrar-motivo">Motivo (visível ao cliente)</Label>
          <Textarea
            id="entrar-motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="Ex.: verificar o erro reportado no faturamento…"
            rows={2}
            error={touched && tooShort}
          />
          {touched && tooShort && (
            <p className="mt-1 text-xs text-danger">Descreva o motivo (mínimo 5 caracteres).</p>
          )}
        </div>
      </form>
    </FormDialog>
  );
}
