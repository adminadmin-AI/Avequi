'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock,
  Info,
  Loader2,
  Paperclip,
  MessageCircle,
  Plus,
  Search,
  Send,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import {
  ConversationSummary,
  QuickReply,
  WaMessage,
  renderQuickReply,
  windowRemaining,
} from './inbox-types';
import { LeadPanel } from './lead-panel';
import { MediaAttachment } from './media-attachment';
import { NewLeadDialog } from './new-lead-dialog';
import { QuickReplyPicker } from './quick-reply-picker';
import { TemplateSender } from './template-sender';

/**
 * Inbox WhatsApp (CRM F1.3 #509) — a tela do vendedor. Resposta 100% LIVRE:
 * nenhum campo obrigatório antes de responder. Mobile-first: lista → chat →
 * painel navegam empilhados abaixo de lg.
 */
export default function InboxPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [search, setSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [draft, setDraft] = useState('');
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const knownLeads = useRef<Set<string>>(new Set());

  const { data: conversations = [], isLoading } = useQuery<ConversationSummary[]>({
    queryKey: ['crm-conversations', scope, search],
    queryFn: async () =>
      (await apiClient.get('/crm/conversations', { params: { scope, search: search || undefined } }))
        .data,
    refetchInterval: 5000,
  });

  // notificação in-app de lead novo (sem refresh)
  useEffect(() => {
    if (conversations.length === 0) return;
    const first = knownLeads.current.size === 0;
    for (const c of conversations) {
      if (!first && !knownLeads.current.has(c.leadId) && c.lastMessage?.direction === 'IN') {
        toast.info(`Novo lead: ${c.lead.name ?? c.lead.phone ?? 'WhatsApp'}`);
      }
      knownLeads.current.add(c.leadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  const selected = useMemo(
    () => conversations.find((c) => c.leadId === selectedLeadId) ?? null,
    [conversations, selectedLeadId],
  );

  const { data: chat } = useQuery<{ messages: WaMessage[] }>({
    queryKey: ['crm-messages', selectedLeadId],
    queryFn: async () =>
      (await apiClient.get(`/crm/whatsapp/leads/${selectedLeadId}/messages`, { params: { take: 100 } }))
        .data,
    enabled: !!selectedLeadId,
    refetchInterval: 3000,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages?.length, selectedLeadId]);

  const send = useMutation({
    mutationFn: (text: string) =>
      apiClient.post(`/crm/whatsapp/leads/${selectedLeadId}/messages`, { text }),
    onSuccess: () => {
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['crm-messages', selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha no envio'),
  });

  const sendMedia = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiClient.post(`/crm/whatsapp/leads/${selectedLeadId}/media`, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm-messages', selectedLeadId] });
      queryClient.invalidateQueries({ queryKey: ['crm-conversations'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao enviar mídia'),
  });

  function handleSend() {
    const text = draft.trim();
    if (!text || !selectedLeadId || send.isPending) return;
    send.mutate(text);
  }

  // ── Respostas rápidas (F3.5-C3 #553): "/" abre a lista, Tab/Enter expande ──
  const { data: quickReplies = [] } = useQuery<QuickReply[]>({
    queryKey: ['crm-quick-replies'],
    queryFn: async () => (await apiClient.get('/crm/quick-replies')).data,
    staleTime: 60_000,
  });

  // draft do tipo "/" ou "/atalho-parcial" → termo de busca; senão picker fechado
  const slashQuery = useMemo(() => {
    const m = draft.match(/^\/([a-z0-9_-]*)$/i);
    return m ? m[1].toLowerCase() : null;
  }, [draft]);

  const pickerMatches = useMemo(() => {
    if (slashQuery == null || pickerDismissed) return [];
    // API devolve pessoais primeiro — em atalho repetido, a pessoal vence
    const seen = new Set<string>();
    return quickReplies.filter((q) => {
      if (!q.shortcut.startsWith(slashQuery) || seen.has(q.shortcut)) return false;
      seen.add(q.shortcut);
      return true;
    });
  }, [slashQuery, pickerDismissed, quickReplies]);

  useEffect(() => {
    setPickerIndex(0);
    if (slashQuery == null) setPickerDismissed(false); // Esc vale só p/ o "/" atual
  }, [slashQuery]);

  function pickQuickReply(q: QuickReply) {
    setDraft(renderQuickReply(q.text, selected?.lead.name));
    setPickerDismissed(false);
  }

  function handleComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerMatches.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setPickerIndex((i) => (i + delta + pickerMatches.length) % pickerMatches.length);
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        pickQuickReply(pickerMatches[pickerIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setPickerDismissed(true);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const windowLeft = selected ? windowRemaining(selected.windowExpiresAt) : null;

  return (
    <div className="flex h-[calc(100vh-7rem)] overflow-hidden rounded-lg border">
      {/* Lista de conversas */}
      <aside
        className={`flex w-full flex-col border-r lg:w-80 lg:shrink-0 ${
          selectedLeadId ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              <h1 className="font-semibold">Inbox WhatsApp</h1>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setNewLeadOpen(true)} aria-label="Novo lead">
              <Plus className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Novo</span>
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              className="w-full rounded-md border bg-background py-2 pl-8 pr-2 text-sm"
              placeholder="Buscar nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(['mine', 'all'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-full px-3 py-1 text-xs ${
                  scope === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {s === 'mine' ? 'Meus' : 'Todos'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-6 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading && conversations.length === 0 && (
            <EmptyState
              icon={MessageCircle}
              title="Sem conversas"
              description={scope === 'mine' ? 'Nenhum lead atribuído a você ainda.' : 'Nenhuma conversa na loja.'}
            />
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedLeadId(c.leadId)}
              className={`flex w-full items-start gap-2 border-b p-3 text-left hover:bg-muted/50 ${
                c.leadId === selectedLeadId ? 'bg-muted' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${c.unreadCount > 0 ? 'font-semibold' : ''}`}>
                    {c.lead.name ?? c.lead.phone ?? 'Sem nome'}
                  </span>
                  {c.lastMessageAt && (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {timeAgo(c.lastMessageAt)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  {c.lastMessage && (
                    <p className="truncate text-xs text-muted-foreground">
                      {c.lastMessage.direction === 'OUT' ? '→ ' : ''}
                      {c.lastMessage.preview}
                    </p>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {c.lead.stage && (
                    <Badge variant="neutral" className="text-[10px]">
                      {c.lead.stage.name}
                    </Badge>
                  )}
                  {scope === 'all' && c.lead.assignedTo && (
                    <span className="text-[10px] text-muted-foreground">
                      {c.lead.assignedTo.id === user?.id ? 'você' : c.lead.assignedTo.name}
                    </span>
                  )}
                  {!c.windowOpen && (
                    <Badge variant="warning" className="text-[10px]">
                      janela fechada
                    </Badge>
                  )}
                </div>
              </div>
              {c.unreadCount > 0 && (
                <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground">
                  {c.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      {/* Chat */}
      <section className={`min-w-0 flex-1 flex-col ${selectedLeadId ? 'flex' : 'hidden lg:flex'}`}>
        {!selected ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Selecione uma conversa
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2 border-b p-3">
              <button
                className="lg:hidden"
                onClick={() => setSelectedLeadId(null)}
                aria-label="Voltar"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {selected.lead.name ?? selected.lead.phone}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {windowLeft ? `janela: ${windowLeft} restantes` : 'janela de 24h expirada'}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowPanel((v) => !v)}>
                <Info className="h-4 w-4" />
                <span className="ml-1 hidden sm:inline">Lead</span>
              </Button>
            </header>

            <div className="flex-1 space-y-2 overflow-y-auto bg-muted/20 p-3">
              {(chat?.messages ?? []).map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
                      m.direction === 'OUT'
                        ? 'rounded-br-sm bg-primary text-primary-foreground'
                        : 'rounded-bl-sm border bg-background'
                    }`}
                  >
                    {m.waMediaId && (
                      <div className="mb-1">
                        <MediaAttachment
                          messageId={m.id}
                          type={m.type}
                          mimeType={m.mediaMimeType}
                        />
                      </div>
                    )}
                    {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                    <div
                      className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                        m.direction === 'OUT' ? 'text-primary-foreground/70' : 'text-muted-foreground'
                      }`}
                    >
                      {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {m.direction === 'OUT' && <StatusTicks status={m.status} />}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <footer className="border-t p-3">
              {windowLeft ? (
                <div className="relative flex items-end gap-2">
                  <QuickReplyPicker
                    matches={pickerMatches}
                    activeIndex={pickerIndex}
                    onPick={pickQuickReply}
                  />
                  <label
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                    title="Anexar foto/PDF"
                  >
                    {sendMedia.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Paperclip className="h-4 w-4" />
                    )}
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,application/pdf,audio/*"
                      disabled={sendMedia.isPending}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) sendMedia.mutate(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <textarea
                    className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-background p-2 text-sm"
                    placeholder='Escreva livremente... ("/" abre respostas rápidas, Enter envia)'
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                  />
                  <Button onClick={handleSend} disabled={!draft.trim() || send.isPending} aria-label="Enviar">
                    {send.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ) : (
                <TemplateSender leadId={selected.leadId} />
              )}
            </footer>
          </>
        )}
      </section>

      {/* Painel do lead */}
      {selected && showPanel && (
        <aside className="absolute inset-0 z-10 flex w-full flex-col border-l bg-background lg:static lg:z-auto lg:w-80 lg:shrink-0">
          <LeadPanel leadId={selected.leadId} onClose={() => setShowPanel(false)} />
        </aside>
      )}

      <NewLeadDialog
        open={newLeadOpen}
        onOpenChange={setNewLeadOpen}
        onOpenLead={(leadId) => setSelectedLeadId(leadId)}
      />
    </div>
  );
}

function StatusTicks({ status }: { status: string }) {
  if (status === 'READ') return <CheckCheck className="h-3.5 w-3.5 text-sky-300" />;
  if (status === 'DELIVERED') return <CheckCheck className="h-3.5 w-3.5" />;
  if (status === 'FAILED') return <span title="falhou">!</span>;
  return <Check className="h-3.5 w-3.5" />;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
