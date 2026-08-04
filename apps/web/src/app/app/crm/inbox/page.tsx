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
  Paintbrush,
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
import { AudioRecorder } from './audio-recorder';
import { AUTO_THEME_OPTION, CHAT_THEMES, useChatTheme } from './chat-themes';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LeadPanel } from './lead-panel';
import { MediaAttachment } from './media-attachment';
import { NewLeadDialog } from './new-lead-dialog';
import { PushBanner } from './push-banner';
import { QuickReplyPicker } from './quick-reply-picker';
import { RemindersStrip } from './reminders-strip';
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

  const [scope, setScope] = useState<'mine' | 'all' | 'ia'>('mine');
  const [search, setSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const { theme: chatTheme, activeKey: chatThemeKey, setTheme: setChatTheme } = useChatTheme();
  const [draft, setDraft] = useState('');
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const knownLeads = useRef<Set<string>>(new Set());

  const { data: allConversations = [], isLoading } = useQuery<ConversationSummary[]>({
    queryKey: ['crm-conversations', scope, search],
    queryFn: async () =>
      (
        await apiClient.get('/crm/conversations', {
          params: { scope: scope === 'ia' ? 'all' : scope, search: search || undefined },
        })
      ).data,
    refetchInterval: 5000,
  });
  // vista "Atendimentos da IA" (#524): conversas com SDR ativo em tempo real
  const conversations =
    scope === 'ia'
      ? allConversations.filter(
          (c) => c.lead.sdrStatus === 'ACTIVE' || c.lead.sdrStatus === 'QUALIFIED',
        )
      : allConversations;

  // deep link do push (#568): clique na notificação abre direto a conversa
  useEffect(() => {
    const leadId = new URLSearchParams(window.location.search).get('lead');
    if (leadId) setSelectedLeadId(leadId);
  }, []);

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
    <div className="surface-sheen flex h-[calc(100vh-6.5rem)] overflow-hidden rounded-xl bg-surface shadow-soft">
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
              <h1 className="font-semibold">Conversas</h1>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setNewLeadOpen(true)} aria-label="Novo lead">
              <Plus className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Novo</span>
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-content-muted" />
            <input
              className="w-full rounded-md border bg-surface py-2 pl-8 pr-2 text-sm"
              placeholder="Buscar nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex gap-1">
            {(['mine', 'all', 'ia'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-full px-3 py-1 text-xs ${
                  scope === s ? 'bg-brand-600 text-white' : 'bg-neutral-500/[0.08] text-content-muted'
                }`}
              >
                {s === 'mine' ? 'Meus' : s === 'all' ? 'Todos' : '🤖 IA'}
              </button>
            ))}
          </div>
        </div>

        <PushBanner />
        <RemindersStrip onOpenLead={(leadId) => setSelectedLeadId(leadId)} />

        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="p-6 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-content-muted" />
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
              className={`flex w-full items-start gap-2 border-b p-3 text-left hover:bg-neutral-500/[0.05] ${
                c.leadId === selectedLeadId ? 'bg-neutral-500/[0.08]' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${c.unreadCount > 0 ? 'font-semibold' : ''}`}>
                    {c.lead.name ?? c.lead.phone ?? 'Sem nome'}
                  </span>
                  {c.lastMessageAt && (
                    <span className="shrink-0 text-[11px] text-content-muted">
                      {timeAgo(c.lastMessageAt)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1">
                  {c.lastMessage && (
                    <p className="truncate text-xs text-content-muted">
                      {c.lastMessage.direction === 'OUT' ? '→ ' : ''}
                      {c.lastMessage.preview}
                    </p>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(c.lead.sdrStatus === 'ACTIVE' || c.lead.sdrStatus === 'QUALIFIED') && (
                    <Badge variant="info" className="text-[10px]">
                      🤖 IA
                    </Badge>
                  )}
                  {c.lead.stage && (
                    <Badge variant="neutral" className="text-[10px]">
                      {c.lead.stage.name}
                    </Badge>
                  )}
                  {scope === 'all' && c.lead.assignedTo && (
                    <span className="text-[10px] text-content-muted">
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
                <span className="mt-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-medium text-white">
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
          /* Sem conversa aberta: o papel de parede do tema já dá o clima */
          <div className="relative h-full" style={{ background: chatTheme.bg }}>
            {chatTheme.doodle && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage: chatTheme.doodle,
                  backgroundSize: '180px 180px',
                  opacity: chatTheme.doodleOpacity,
                }}
              />
            )}
            <div className="absolute right-2 top-2">
              <ThemePicker activeKey={chatThemeKey} onPick={setChatTheme} />
            </div>
            <div className="relative flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <MessageCircle
                className="h-12 w-12"
                style={{ color: chatTheme.timeIn }}
                strokeWidth={1.2}
              />
              <p className="text-sm" style={{ color: chatTheme.timeIn }}>
                Selecione uma conversa para começar
              </p>
            </div>
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
                <div className="flex items-center gap-1 text-xs text-content-muted">
                  <Clock className="h-3 w-3" />
                  {windowLeft ? `janela: ${windowLeft} restantes` : 'janela de 24h expirada'}
                </div>
              </div>
              {/* Tema da conversa — papel de parede, igual WhatsApp */}
              <ThemePicker activeKey={chatThemeKey} onPick={setChatTheme} />
              <Button variant="ghost" size="sm" onClick={() => setShowPanel((v) => !v)}>
                <Info className="h-4 w-4" />
                <span className="ml-1 hidden sm:inline">Lead</span>
              </Button>
            </header>

            {/* Área de conversa — papel de parede FIXO atrás (não rola com
                as mensagens), igual WhatsApp; cores vêm do tema escolhido */}
            <div className="relative flex-1 overflow-hidden" style={{ background: chatTheme.bg }}>
              {chatTheme.doodle && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage: chatTheme.doodle,
                    backgroundSize: '180px 180px',
                    opacity: chatTheme.doodleOpacity,
                  }}
                />
              )}
              <div className="relative h-full space-y-2 overflow-y-auto p-3">
                {(chat?.messages ?? []).map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm shadow-sm sm:max-w-[70%] ${
                        m.direction === 'OUT' ? 'rounded-tr-none' : 'rounded-tl-none'
                      }`}
                      style={
                        m.direction === 'OUT'
                          ? { background: chatTheme.bubbleOut.background, color: chatTheme.bubbleOut.color }
                          : { background: chatTheme.bubbleIn.background, color: chatTheme.bubbleIn.color }
                      }
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
                        className="mt-0.5 flex items-center justify-end gap-1 text-[10px]"
                        style={{
                          color: m.direction === 'OUT' ? chatTheme.timeOut : chatTheme.timeIn,
                        }}
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
            </div>

            <footer className="border-t p-3">
              {windowLeft ? (
                <div className="relative flex items-end gap-2">
                  <QuickReplyPicker
                    matches={pickerMatches}
                    activeIndex={pickerIndex}
                    onPick={pickQuickReply}
                  />
                  {!recordingAudio && (
                    <label
                      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md border text-content-muted hover:bg-neutral-500/[0.06]"
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
                  )}
                  <AudioRecorder
                    onSend={(f) => sendMedia.mutate(f)}
                    sending={sendMedia.isPending}
                    onRecordingChange={setRecordingAudio}
                  />
                  {!recordingAudio && (
                    <>
                      <textarea
                        className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-surface p-2 text-sm"
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
                    </>
                  )}
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
        <aside className="absolute inset-0 z-10 flex w-full flex-col border-l bg-surface lg:static lg:z-auto lg:w-80 lg:shrink-0">
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

/** Seletor de tema da conversa (papel de parede) — usado no cabeçalho da
 *  conversa e na área vazia, para o tema ser trocável mesmo sem conversa. */
function ThemePicker({ activeKey, onPick }: { activeKey: string; onPick: (k: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Tema da conversa">
          <Paintbrush className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {[AUTO_THEME_OPTION, ...CHAT_THEMES].map((t) => (
          <DropdownMenuItem key={t.key} onSelect={() => onPick(t.key)}>
            <span
              aria-hidden
              className="mr-2 inline-block h-4 w-4 rounded-full border border-line"
              style={{ background: t.swatch }}
            />
            {t.label}
            {t.key === activeKey && <Check className="ml-auto h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
