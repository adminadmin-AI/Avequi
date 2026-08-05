'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Rocket, ShoppingCart, Sparkles, UserRound, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/can';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';
import {
  ACTIVITY_LABEL,
  LeadDetail,
  SOURCE_LABEL,
  StageRef,
} from './inbox-types';
import { LeadNotesReminders } from './lead-notes-reminders';
import { LOST_REASON_OPTIONS, lostReasonLabel, type LostReasonCategory } from '@/lib/crm-lost-reasons';

/** #573 — rótulos dos dados descobertos pela IA no resumo da conversa */
const DISCOVERED_LABEL: Record<string, string> = {
  cidade: 'Cidade',
  necessidade: 'Necessidade',
  prazo: 'Prazo',
  pagamento: 'Pagamento',
};

/**
 * Painel lateral do lead (F1.3 #509): dados, troca rápida de estágio,
 * timeline. "Converter em orçamento" é placeholder até a F2.2 (#515).
 */
export function LeadPanel({ leadId, onClose }: { leadId: string; onClose?: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [lostReason, setLostReason] = useState('');
  const [lostCategory, setLostCategory] = useState<LostReasonCategory | ''>('');
  const [pendingLostStage, setPendingLostStage] = useState<StageRef | null>(null);
  const [showProposals, setShowProposals] = useState(false); // #572

  const convert = useMutation({
    mutationFn: () => apiClient.post(`/crm/leads/${leadId}/convert`),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['crm-lead', leadId] });
      toast.success(data?.created ? 'Cliente criado. Abrindo nova venda.' : 'Cliente vinculado. Abrindo nova venda.');
      // leva pra tela de venda já com o cliente e o lead na query (a OV volta
      // vinculada via POST /crm/leads/:id/link-order)
      const params = new URLSearchParams({ customerId: data.customerId, leadId });
      router.push(`/app/sales/new?${params.toString()}`);
    },
    onError: (e: any) => toast.error(erroDeAcao('converter o lead em cliente', e)),
  });

  const { data: lead } = useQuery<LeadDetail>({
    queryKey: ['crm-lead', leadId],
    queryFn: async () => (await apiClient.get(`/crm/leads/${leadId}`)).data,
    refetchInterval: 10_000,
  });
  const { data: stages = [] } = useQuery<StageRef[]>({
    queryKey: ['crm-stages'],
    queryFn: async () => (await apiClient.get('/crm/stages')).data,
    staleTime: 5 * 60_000,
  });

  // #573 — resumo IA da conversa: condensa o histórico numa nota da timeline
  const summarize = useMutation({
    mutationFn: () => apiClient.post(`/crm/leads/${leadId}/summarize`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-lead', leadId] }); // timeline
      toast.success('Resumo da conversa gerado na timeline');
    },
    onError: (e: any) => toast.error(erroDeAcao('resumir a conversa', e)),
  });

  // takeover explícito do SDR IA (F4.4 #524) — IA silencia em 1 clique
  const takeover = useMutation({
    mutationFn: () => apiClient.post(`/crm/leads/${leadId}/sdr/takeover`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      toast.success('Você assumiu a conversa. IA silenciada.');
      // #573 — disparo automático do resumo no takeover explícito: quem assume
      // já recebe o contexto condensado sem precisar reler a conversa.
      if (lead?.aiSummaryAvailable && !summarize.isPending) summarize.mutate();
    },
    onError: (e: any) => toast.error(erroDeAcao('assumir a conversa', e)),
  });

  // #572 — proposta em PDF: cotações do cliente vinculado + envio no chat
  const { data: proposalOptions, isLoading: loadingProposals } = useQuery<{
    customerLinked: boolean;
    quotations: Array<{ id: string; status: string; total: number; createdAt: string; validUntil: string | null }>;
  }>({
    queryKey: ['crm-lead-proposals', leadId],
    queryFn: async () => (await apiClient.get(`/crm/leads/${leadId}/proposal-options`)).data,
    enabled: showProposals,
  });

  const sendProposal = useMutation({
    mutationFn: (quotationId: string) =>
      apiClient.post(`/crm/leads/${leadId}/send-proposal`, { quotationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['crm-messages', leadId] });
      setShowProposals(false);
      toast.success('Proposta enviada no WhatsApp do cliente');
    },
    onError: (e: any) => toast.error(erroDeAcao('enviar a proposta', e)),
  });

  const changeStage = useMutation({
    mutationFn: (body: { stageId: string; lostReason?: string; lostReasonCategory?: LostReasonCategory }) =>
      apiClient.patch(`/crm/leads/${leadId}/stage`, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['crm-lead', leadId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
      setPendingLostStage(null);
      setLostReason('');
      setLostCategory('');
      const nome = stages.find((s) => s.id === variables.stageId)?.name;
      toast.success(nome ? `Lead movido para ${nome}` : 'Estágio do lead atualizado');
    },
    onError: (e: any) => toast.error(erroDeAcao('mudar o estágio do lead', e)),
  });

  function onStageSelect(stageId: string) {
    const stage = stages.find((s) => s.id === stageId);
    if (!stage || stage.id === lead?.stage?.id) return;
    if (stage.type === 'LOST') {
      setPendingLostStage(stage); // Perdido exige motivo
      return;
    }
    changeStage.mutate({ stageId });
  }

  if (!lead) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex items-center gap-2 font-medium">
          <UserRound className="h-4 w-4" />
          {lead.name ?? lead.phone ?? 'Lead'}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Fechar painel" className="text-content-muted">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-3 p-3 text-sm">
        {/* #574 — cliente negociando em outra loja: avisa ANTES de dar preço */}
        {(lead.crossStoreStores?.length ?? 0) > 0 && (
          <div className="rounded-md bg-amber-500/[0.08] p-2.5 text-xs">
            ⚠️ Cliente também em negociação na loja{' '}
            <b>{lead.crossStoreStores!.join(', ')}</b>. Alinhe o preço antes de propor.
          </div>
        )}
        {(lead.sdrStatus === 'ACTIVE' || lead.sdrStatus === 'QUALIFIED') && (
          <div className="flex items-center justify-between rounded-md bg-sky-500/[0.08] p-2.5">
            <span className="text-xs">🤖 IA atendendo esta conversa</span>
            <Button size="sm" variant="secondary" disabled={takeover.isPending} onClick={() => takeover.mutate()}>
              Assumir conversa
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Info label="Origem" value={SOURCE_LABEL[lead.source] ?? lead.source} />
          <Info label="Telefone" value={lead.phone ?? '—'} />
          <Info label="Interesse" value={lead.interest ?? '—'} />
          <Info label="Vendedor" value={lead.assignedTo?.name ?? 'sem atribuição'} />
        </div>

        <div>
          <label className="mb-1 block text-xs text-content-muted">Estágio</label>
          <select
            className="w-full rounded-md border bg-surface px-2 py-1.5 text-sm"
            value={lead.stage?.id ?? ''}
            onChange={(e) => onStageSelect(e.target.value)}
            disabled={changeStage.isPending}
          >
            {!lead.stage && <option value="">Sem estágio</option>}
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {(lead.lostReasonCategory || lead.lostReason) && (
            <p className="mt-1 text-xs text-content-muted">
              Perda: {lostReasonLabel(lead.lostReasonCategory)}
              {lead.lostReason ? ` · ${lead.lostReason}` : ''}
            </p>
          )}
        </div>

        {pendingLostStage && (
          <div className="space-y-2 rounded-md bg-danger/[0.06] p-2.5">
            <p className="text-xs">
              Mover para <b>{pendingLostStage.name}</b> exige a categoria do motivo:
            </p>
            <select
              className="w-full rounded-md border bg-surface px-2 py-1.5 text-sm"
              value={lostCategory}
              onChange={(e) => setLostCategory(e.target.value as LostReasonCategory | '')}
            >
              <option value="">Categoria (obrigatória)…</option>
              {LOST_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <textarea
              className="w-full rounded-md border bg-surface p-2 text-sm"
              rows={2}
              value={lostReason}
              maxLength={300}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Detalhe opcional (ex.: achou mais barato na loja X)"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={!lostCategory || changeStage.isPending}
                onClick={() =>
                  changeStage.mutate({
                    stageId: pendingLostStage.id,
                    lostReasonCategory: lostCategory as LostReasonCategory,
                    ...(lostReason.trim() ? { lostReason: lostReason.trim() } : {}),
                  })
                }
              >
                Confirmar perda
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingLostStage(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* #962 — venda SaaS (CRM da operadora): lead ganho → wizard de
            onboarding do portal em 1 clique, com contato pré-preenchido.
            Gate por ops.tenants.provision: no CRM dos tenants clientes o
            botão simplesmente não existe (UX; enforcement segue no backend). */}
        {lead.stage?.type === 'WON' && (
          <Can permission="ops.tenants.provision">
            <Button
              className="w-full"
              onClick={() => {
                const params = new URLSearchParams();
                if (lead.name) params.set('adminName', lead.name);
                if (lead.email) params.set('adminEmail', lead.email);
                const qs = params.toString();
                router.push(`/app/ops/new${qs ? `?${qs}` : ''}`);
              }}
            >
              <Rocket className="mr-2 h-4 w-4" />
              Abrir onboarding no portal
            </Button>
          </Can>
        )}

        <Button
          className="w-full"
          disabled={convert.isPending}
          onClick={() => convert.mutate()}
        >
          {convert.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShoppingCart className="mr-2 h-4 w-4" />
          )}
          {lead.customer ? 'Nova venda' : 'Converter em pedido de venda'}
        </Button>
        {lead.customer && (
          <p className="text-center text-[11px] text-content-muted">
            Cliente: {lead.customer.name}
          </p>
        )}

        {/* #572 — proposta em PDF da cotação direto no chat */}
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => {
            if (!lead.customer) {
              toast.info('Converta o lead em cliente primeiro. A proposta sai de um orçamento do cliente.');
              return;
            }
            setShowProposals((v) => !v);
          }}
        >
          <FileText className="mr-2 h-4 w-4" />
          Enviar proposta
        </Button>
        {showProposals && (
          <div className="space-y-2 rounded-md bg-neutral-500/[0.04] p-2.5">
            {loadingProposals ? (
              <p className="py-2 text-center text-xs text-content-muted">Carregando orçamentos…</p>
            ) : (proposalOptions?.quotations.length ?? 0) === 0 ? (
              <p className="py-2 text-center text-xs text-content-muted">
                Nenhum orçamento deste cliente. Crie um em Comercial → Orçamentos.
              </p>
            ) : (
              proposalOptions!.quotations.map((qt) => (
                <div key={qt.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      #{qt.id.slice(-8).toUpperCase()} ·{' '}
                      {qt.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                    <p className="text-content-muted">
                      {qt.status} · {new Date(qt.createdAt).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    disabled={sendProposal.isPending}
                    onClick={() => sendProposal.mutate(qt.id)}
                  >
                    {sendProposal.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Enviar PDF'}
                  </Button>
                </div>
              ))
            )}
          </div>
        )}

        {/* #573 — resumo IA da conversa (oculto sem ANTHROPIC_API_KEY) */}
        {lead.aiSummaryAvailable && (
          <Button
            variant="secondary"
            className="w-full"
            disabled={summarize.isPending}
            onClick={() => summarize.mutate()}
            title="Gera um resumo da conversa por IA e salva na timeline"
          >
            {summarize.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Resumir conversa
          </Button>
        )}

        <LeadNotesReminders leadId={leadId} />

        <div>
          <h3 className="mb-2 text-xs font-medium uppercase text-content-muted">Timeline</h3>
          {/* F4: timeline sem caixinhas — trilho de dots + espaço; caixa só
              onde há conteúdo destacável (resumo IA, tint sem borda) */}
          <ul className="space-y-3">
            {lead.activities.map((a) => {
              const isSummary = a.properties?.kind === 'conversation_summary';
              return (
                <li key={a.id} className="relative pl-4">
                  <span
                    className={`absolute left-0 top-[5px] h-1.5 w-1.5 rounded-full ${
                      isSummary ? 'bg-violet-500' : 'bg-neutral-300 dark:bg-neutral-600'
                    }`}
                  />
                  <div className="flex items-center justify-between">
                    {isSummary ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
                        <Sparkles className="h-3 w-3" /> Resumo IA
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-content-secondary">
                        {ACTIVITY_LABEL[a.type] ?? a.type}
                      </span>
                    )}
                    <span className="text-[11px] text-content-muted">
                      {new Date(a.happensAt).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {isSummary ? (
                    <>
                      {typeof a.properties?.summary === 'string' && (
                        <p className="mt-1.5 whitespace-pre-line rounded-md bg-violet-500/[0.06] p-2 text-xs">
                          {a.properties.summary as string}
                        </p>
                      )}
                      {a.properties?.discovered &&
                        Object.keys(a.properties.discovered as Record<string, string>).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {Object.entries(a.properties.discovered as Record<string, string>).map(
                              ([k, v]) => (
                                <span
                                  key={k}
                                  className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-700 dark:text-violet-300"
                                >
                                  <span className="capitalize opacity-70">{DISCOVERED_LABEL[k] ?? k}:</span>{' '}
                                  {v}
                                </span>
                              ),
                            )}
                          </div>
                        )}
                    </>
                  ) : (
                    <>
                      {typeof a.properties?.preview === 'string' && (
                        <p className="mt-1 truncate text-xs text-content-muted">
                          {a.properties.preview as string}
                        </p>
                      )}
                      {typeof a.properties?.toName === 'string' && (
                        <p className="mt-1 text-xs text-content-muted">
                          → {a.properties.toName as string}
                        </p>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-content-muted">{label}</div>
      <div className="truncate">{value}</div>
    </div>
  );
}
