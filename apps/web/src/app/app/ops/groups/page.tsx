'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Network, Plus, Unlink } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ehNegativaDeAcesso, mensagemDoErro } from '@/lib/api-error';
import { erroDeAcao } from '@/lib/feedback';
import { formatCNPJ } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormDialog } from '@/components/ui/form-dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { AtivarMfaLink } from '../ativar-mfa-link';
import { Can } from '@/components/can';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';

const RESOURCE = '/ops/groups';

interface EmpresaDoGrupo {
  id: string;
  name: string;
  razaoSocial: string | null;
  cnpj: string;
  tenantStatus: string;
}

interface GrupoEconomico {
  id: string;
  name: string;
  companies: EmpresaDoGrupo[];
}

interface TenantResumo {
  id: string;
  name: string;
  cnpj: string;
}

/**
 * Operadora — grupos econômicos (#1119).
 *
 * O que esta tela faz, e só isto: declara que N contas de cliente são
 * administradas pelas MESMAS pessoas. Isso não mistura dado nenhum — habilita
 * o admin de cada tenant a conceder acesso cruzado entre as empresas do
 * grupo, e as pessoas a alternar a empresa ativa da sessão.
 *
 * Mora no control plane porque a alternativa seria o admin de um cliente
 * declarar sozinho que tem grupo com outro — ou seja, se auto-conceder acesso
 * a um tenant alheio. Por isso é chamado (o cliente pede, a operadora liga).
 */
export default function OpsGroupsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery<GrupoEconomico[]>({
    queryKey: [RESOURCE],
    queryFn: async () => (await apiClient.get<GrupoEconomico[]>(RESOURCE)).data,
  });

  // Contas disponíveis para associar — a mesma lista do control plane.
  const { data: tenants } = useQuery<TenantResumo[]>({
    queryKey: ['/ops/tenants', 'para-grupo'],
    queryFn: async () => (await apiClient.get<TenantResumo[]>('/ops/tenants')).data,
  });

  const [criarAberto, setCriarAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [associarEm, setAssociarEm] = useState<GrupoEconomico | null>(null);
  const [empresaId, setEmpresaId] = useState('');

  const criarGrupo = useMutation({
    mutationFn: () => apiClient.post(RESOURCE, { name: nome.trim() }),
    onSuccess: () => {
      toast.success('Grupo criado');
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setCriarAberto(false);
      setNome('');
    },
    onError: (err) => toast.error(erroDeAcao('criar o grupo', err)),
  });

  const associar = useMutation({
    mutationFn: () =>
      apiClient.post(`${RESOURCE}/${associarEm!.id}/companies`, { companyId: empresaId }),
    onSuccess: () => {
      toast.success('Conta associada ao grupo');
      qc.invalidateQueries({ queryKey: [RESOURCE] });
      setAssociarEm(null);
      setEmpresaId('');
    },
    onError: (err) => toast.error(erroDeAcao('associar a conta', err)),
  });

  const desassociar = useMutation({
    mutationFn: ({ grupoId, companyId }: { grupoId: string; companyId: string }) =>
      apiClient.delete(`${RESOURCE}/${grupoId}/companies/${companyId}`),
    onSuccess: () => {
      toast.success('Conta removida do grupo');
      qc.invalidateQueries({ queryKey: [RESOURCE] });
    },
    onError: (err) => toast.error(erroDeAcao('remover a conta do grupo', err)),
  });

  async function handleDesassociar(grupo: GrupoEconomico, empresa: EmpresaDoGrupo) {
    const ok = await confirm({
      title: `Tirar ${empresa.name} do grupo?`,
      // O efeito é maior que "editar um cadastro" — precisa estar escrito.
      description:
        'Os acessos cruzados de usuários entre esta conta e as demais do grupo serão ' +
        'REVOGADOS, e quem estiver trabalhando nela por causa do grupo perde a sessão na hora.',
      confirmLabel: 'Tirar do grupo',
      variant: 'danger',
    });
    if (!ok) return;
    desassociar.mutate({ grupoId: grupo.id, companyId: empresa.id });
  }

  if (isError) {
    const negado = ehNegativaDeAcesso(error);
    return (
      <div>
        <PageHeader title="Grupos econômicos" description="Contas administradas pelas mesmas pessoas." />
        <ErrorState
          fullPage={false}
          title={negado ? 'Acesso negado' : 'Não foi possível carregar os grupos'}
          description={
            negado
              ? (mensagemDoErro(error) ?? 'Você não tem permissão para acessar esta área.')
              : (mensagemDoErro(error) ?? 'Tente novamente em instantes.')
          }
          onRetry={negado ? undefined : () => refetch()}
          action={<AtivarMfaLink message={mensagemDoErro(error)} />}
        />
      </div>
    );
  }

  const grupos = data ?? [];
  // Só conta que ainda não está em grupo nenhum pode ser associada.
  const jaAgrupadas = new Set(grupos.flatMap((g) => g.companies.map((c) => c.id)));
  const disponiveis = (tenants ?? []).filter((t) => !jaAgrupadas.has(t.id));

  return (
    <div>
      <PageHeader
        title="Grupos econômicos"
        description="Contas de cliente administradas pelas mesmas pessoas. Habilita acesso cruzado de usuários e troca de empresa na sessão."
        actions={
          <Can permission="ops.groups.manage">
            <Button size="sm" onClick={() => setCriarAberto(true)}>
              <Plus size={15} />
              Novo grupo
            </Button>
          </Can>
        }
      />

      {isLoading ? null : grupos.length === 0 ? (
        <EmptyState
          icon={Network}
          title="Nenhum grupo econômico"
          description="Crie um grupo quando duas ou mais contas forem administradas pelas mesmas pessoas. Normalmente a pedido do cliente, por chamado."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {grupos.map((grupo) => (
            <Card key={grupo.id} className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-content">
                    {grupo.name}
                  </h3>
                  <p className="text-helper text-content-muted">
                    {grupo.companies.length}{' '}
                    {grupo.companies.length === 1 ? 'conta' : 'contas'}
                  </p>
                </div>
                <Can permission="ops.groups.manage">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setAssociarEm(grupo);
                      setEmpresaId('');
                    }}
                  >
                    <Plus size={15} />
                    Associar conta
                  </Button>
                </Can>
              </div>

              {grupo.companies.length === 0 ? (
                <p className="text-sm text-content-muted">
                  Grupo sem contas. Associe pelo menos duas para ele ter efeito.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {grupo.companies.map((empresa) => (
                    <li
                      key={empresa.id}
                      className="flex items-center gap-3 rounded-lg bg-surface-secondary px-3 py-2.5"
                    >
                      <Building2 size={16} className="shrink-0 text-content-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-content">
                          {empresa.name}
                        </p>
                        <p className="truncate text-helper text-content-muted">
                          {formatCNPJ(empresa.cnpj)}
                        </p>
                      </div>
                      <Can permission="ops.groups.manage">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDesassociar(grupo, empresa)}
                        >
                          <Unlink size={15} />
                          Tirar do grupo
                        </Button>
                      </Can>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      <FormDialog
        open={criarAberto}
        onOpenChange={setCriarAberto}
        title="Novo grupo econômico"
        description="Dê um nome que a operadora reconheça (ex.: “Grupo GDR”)."
        formId="form-novo-grupo"
        submitLabel="Criar grupo"
        loading={criarGrupo.isPending}
        size="sm"
      >
        <form
          id="form-novo-grupo"
          onSubmit={(e) => {
            e.preventDefault();
            if (nome.trim().length >= 2) criarGrupo.mutate();
          }}
        >
          <Field label="Nome do grupo" required>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Grupo GDR"
              autoFocus
            />
          </Field>
        </form>
      </FormDialog>

      <FormDialog
        open={!!associarEm}
        onOpenChange={(open) => !open && setAssociarEm(null)}
        title={`Associar conta a ${associarEm?.name ?? ''}`}
        description="Só contas matriz que ainda não pertencem a nenhum grupo aparecem aqui."
        formId="form-associar-conta"
        submitLabel="Associar"
        loading={associar.isPending}
        size="sm"
      >
        <form
          id="form-associar-conta"
          onSubmit={(e) => {
            e.preventDefault();
            if (empresaId) associar.mutate();
          }}
        >
          <Field label="Conta de cliente" required>
            <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
              <option value="">Selecione…</option>
              {disponiveis.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {formatCNPJ(t.cnpj)}
                </option>
              ))}
            </Select>
          </Field>
        </form>
      </FormDialog>
    </div>
  );
}
