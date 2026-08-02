'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Pin, Plus, RotateCcw, StickyNote, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { usePermission } from '@/hooks/use-permission';
import { useToast } from '@/components/ui/toast';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import {
  moveNote,
  NOTE_COLORS,
  NOTE_PALETTE,
  safeColor,
  tiltFor,
  type NoteColor,
} from '../quick-notes';

// dnd-kit fora do chunk inicial: só baixa quando há mural para reordenar.
const NotesDndBoard = dynamic(() => import('./notes-dnd').then((m) => m.NotesDndBoard), {
  ssr: false,
});

/**
 * Notas rápidas — post-its pessoais (ideia do Claudio, 31/07). O ÚNICO lugar
 * onde o esqueumorfismo é honesto: papel + alfinete de ponta vermelha para
 * anotações que o próprio usuário cria e ARRANCA. Puxar o alfinete = resolvido:
 * o post-it levanta, gira e cai com opacidade — a satisfação de tirar da lista.
 *
 * Mural (brief pt.8): as notas têm ORDEM (arraste), podem ser FIXADAS no topo
 * e agora são ARQUIVADAS em vez de excluídas — puxar o alfinete continua sendo
 * o gesto de "resolvido", mas com "Desfazer" no toast e uma gaveta onde tudo
 * que foi arrancado continua existindo. Excluir de vez só de dentro da gaveta:
 * o gesto rápido não pode ser o gesto irreversível.
 *
 * Persistência real: GET/POST/PATCH/DELETE /workspace/notes (privado por
 * usuário). Edição/criação gateadas por workspace.notes.manage; sem a
 * permissão o painel é só leitura.
 */

interface QuickNote {
  id: string;
  text: string;
  color: string;
  position: number;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

const LEAVE_MS = 460;

type NotePatch = Partial<{ text: string; color: NoteColor; pinned: boolean; archived: boolean }>;

export function QuickNotesWidget(_: WidgetComponentProps) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = usePermission();
  const canManage = can('workspace.notes.manage');

  const notesQ = useQuery({
    retry: false,
    staleTime: 60 * 1000,
    queryKey: ['/workspace/notes'],
    queryFn: async () => (await apiClient.get<QuickNote[]>('/workspace/notes')).data,
  });

  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Ordem otimista enquanto o PATCH de reordenação não volta — sem isto a
  // nota "salta de volta" ao soltar e a interação parece quebrada.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);

  const invalidate = () => {
    setDragOrder(null);
    qc.invalidateQueries({ queryKey: ['/workspace/notes'] });
  };

  // Erro nunca some em silêncio (a lição do "cliquei e nada acontece").
  const onError = () => toast.error('Não foi possível salvar a nota. Tente de novo.');

  const createM = useMutation({
    mutationFn: (body: { text: string; color: NoteColor }) =>
      apiClient.post<QuickNote>('/workspace/notes', body).then((r) => r.data),
    onSuccess: (note) => {
      invalidate();
      setEditingId(note.id); // já abre a nota nova para digitar
    },
    onError,
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) =>
      apiClient.patch(`/workspace/notes/${id}`, patch),
    onSuccess: invalidate,
    onError,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/workspace/notes/${id}`),
    onSuccess: invalidate,
    onError,
  });
  const reorderM = useMutation({
    mutationFn: (ids: string[]) => apiClient.patch('/workspace/notes/reorder', { ids }),
    onSuccess: invalidate,
    onError: () => {
      setDragOrder(null); // volta para a ordem do servidor
      toast.error('Não foi possível salvar a nova ordem.');
    },
  });

  // Aplica a ordem otimista sobre os dados do servidor (o conteúdo continua
  // vindo do cache; só a sequência é local).
  const notes = useMemo(() => {
    const serverNotes = notesQ.data ?? [];
    if (!dragOrder) return serverNotes;
    const byId = new Map(serverNotes.map((n) => [n.id, n]));
    const ordered = dragOrder.map((id) => byId.get(id)).filter(Boolean) as QuickNote[];
    const novas = serverNotes.filter((n) => !dragOrder.includes(n.id));
    return [...ordered, ...novas];
  }, [notesQ.data, dragOrder]);

  function archive(id: string) {
    if (leaving.has(id)) return;
    setLeaving((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      updateM.mutate(
        { id, patch: { archived: true } },
        {
          onSuccess: () => {
            invalidate();
            // Arrancar é reversível: o desfazer devolve a nota ao mural.
            toast.success('Nota arquivada', undefined, {
              label: 'Desfazer',
              onClick: () => updateM.mutate({ id, patch: { archived: false } }),
            });
          },
        },
      );
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, LEAVE_MS);
  }

  // Sair da edição: nota que ficou vazia é removida (não polui o mural); com
  // texto, salva só se mudou. Vazia nunca vai para a gaveta — não há o que
  // guardar de um papel em branco.
  function commitText(note: QuickNote, raw: string) {
    const text = raw.trim();
    if (text === '') {
      deleteM.mutate(note.id);
      return;
    }
    if (text !== note.text) updateM.mutate({ id: note.id, patch: { text } });
  }

  function handleReorder(activeId: string, overId: string) {
    const current = notes.map((n) => n.id);
    const next = moveNote(current, activeId, overId);
    if (next === current) return;
    setDragOrder(next);
    reorderM.mutate(next);
  }

  const addNote = () => createM.mutate({ text: '', color: 'yellow' });

  const renderNote = (n: QuickNote) => (
    <PostIt
      note={n}
      leaving={leaving.has(n.id)}
      editing={editingId === n.id}
      canManage={canManage}
      onEdit={() => canManage && setEditingId(n.id)}
      onStopEdit={() => setEditingId((cur) => (cur === n.id ? null : cur))}
      onSaveColor={(color) => updateM.mutate({ id: n.id, patch: { color } })}
      onCommitText={(text) => commitText(n, text)}
      onArchive={() => archive(n.id)}
      onTogglePin={() => updateM.mutate({ id: n.id, patch: { pinned: !n.pinned } })}
    />
  );

  // Arrastar só faz sentido com mural de 2+ e permissão de gerenciar; e nunca
  // durante a edição de uma nota (o gesto entraria em conflito com o cursor).
  const sortable = canManage && notes.length > 1 && editingId === null;

  return (
    <>
      <WidgetFrame
        title="Notas rápidas"
        badge={notes.length}
        action={
          canManage && notes.length > 0 ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDrawerOpen(true)}
                className="text-caption font-medium text-content-muted transition-colors duration-micro hover:text-content"
              >
                Arquivadas
              </button>
              <button
                onClick={addNote}
                className="flex items-center gap-1 text-caption font-medium text-brand-600 transition-colors duration-micro hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
              >
                <Plus size={14} /> Nova nota
              </button>
            </div>
          ) : undefined
        }
      >
        {notesQ.isLoading ? (
          <ListSkeleton />
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <EmptyState
              icon={StickyNote}
              title="Nenhuma nota no mural"
              hint={canManage ? 'Fixe um lembrete rápido — só seu.' : 'Nada por aqui.'}
            />
            {canManage && (
              <div className="flex items-center gap-2">
                <button
                  onClick={addNote}
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-caption font-medium text-content-secondary transition-colors duration-micro hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-600 dark:hover:text-brand-400"
                >
                  <Plus size={14} /> Fixar primeira nota
                </button>
                <button
                  onClick={() => setDrawerOpen(true)}
                  className="text-caption font-medium text-content-muted transition-colors duration-micro hover:text-content"
                >
                  Ver arquivadas
                </button>
              </div>
            )}
          </div>
        ) : sortable ? (
          <NotesDndBoard ids={notes.map((n) => n.id)} onReorder={handleReorder}>
            {(id) => {
              const n = notes.find((x) => x.id === id);
              return n ? renderNote(n) : null;
            }}
          </NotesDndBoard>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-6 pt-2">
            {notes.map((n) => (
              <div key={n.id}>{renderNote(n)}</div>
            ))}
          </div>
        )}
      </WidgetFrame>

      <ArchivedDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        canManage={canManage}
        onRestore={(id) => updateM.mutate({ id, patch: { archived: false } })}
        onDelete={(id) => deleteM.mutate(id)}
      />
    </>
  );
}

function PostIt({
  note,
  leaving,
  editing,
  canManage,
  onEdit,
  onStopEdit,
  onSaveColor,
  onCommitText,
  onArchive,
  onTogglePin,
}: {
  note: QuickNote;
  leaving: boolean;
  editing: boolean;
  canManage: boolean;
  onEdit: () => void;
  onStopEdit: () => void;
  onSaveColor: (color: NoteColor) => void;
  onCommitText: (text: string) => void;
  onArchive: () => void;
  onTogglePin: () => void;
}) {
  const color = safeColor(note.color);
  const pal = NOTE_PALETTE[color];
  // Fixada fica RETA: o papel torto é o que está solto no mural.
  const tilt = note.pinned ? 0 : tiltFor(note.id);
  const [draft, setDraft] = useState(note.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      const el = areaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [editing]);

  // Sincroniza o rascunho se a nota mudar por fora enquanto não estou editando.
  useEffect(() => {
    if (!editing) setDraft(note.text);
  }, [note.text, editing]);

  function commit() {
    onStopEdit();
    onCommitText(draft);
  }

  // Papel: gradiente topo→base. Fora do "arrancar", a inclinação vai numa CSS
  // var que a classe .quick-note lê (assim o hover mantém o tilt). No arrancar,
  // o transform inline (queda) vence a classe — a nota levanta, gira e cai.
  const paperStyle = {
    background: `linear-gradient(160deg, ${pal.paper[0]} 0%, ${pal.paper[1]} 100%)`,
    color: pal.text,
    ...(leaving
      ? { transform: 'translateY(-10px) rotate(12deg) scale(0.9)' }
      : { ['--note-tilt' as string]: `${tilt}deg` }),
  } as CSSProperties;

  return (
    <div
      onClick={() => !editing && canManage && onEdit()}
      className={cn(
        'quick-note group/note relative w-[150px] min-h-[150px] shrink-0 rounded-[2px] px-3.5 pb-4 pt-6',
        !editing && canManage && 'cursor-text',
        // fade-in anima só opacidade (sem transform) — não briga com o tilt
        leaving ? 'z-10 opacity-0 transition-all duration-[460ms] ease-flow' : 'animate-in fade-in duration-flow',
        note.pinned && 'quick-note-pinned',
      )}
      style={paperStyle}
    >
      {/* Alfinete 3D tonal — puxar = resolver. Contra-rotaciona pra ficar
          "de pé" enquanto o papel inclina (realismo da referência). */}
      {canManage && (
        <>
          <span
            aria-hidden
            className="quick-pin-shadow pointer-events-none absolute left-1/2 top-2.5 z-10 h-2 w-5 -translate-x-[30%] rounded-full"
          />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            aria-label="Arrancar nota (vai para as arquivadas)"
            title="Arrancar — vai para as arquivadas"
            className="group absolute left-1/2 top-[-13px] z-20 h-[30px] w-[26px] focus:outline-none"
            style={{ transform: `translateX(-50%) rotate(${-tilt}deg)` }}
          >
            <span className="block transition-transform duration-fast ease-orbital group-hover:-translate-y-[1.5px] group-active:translate-y-0.5">
              {/* cabeça (domo com brilho especular) */}
              <span
                className="absolute left-1/2 top-0 h-5 w-5 -translate-x-1/2 rounded-full"
                style={{
                  background: `radial-gradient(circle at 34% 30%, ${pal.pin[0]}, ${pal.pin[1]} 55%, ${pal.pin[2]} 100%)`,
                  boxShadow: '0 3px 5px rgba(0,0,0,.30), inset 0 -2px 4px rgba(0,0,0,.25)',
                }}
              >
                <span
                  className="absolute left-1 top-[3px] h-[6px] w-[7px] rounded-full"
                  style={{
                    background:
                      'radial-gradient(circle at 50% 50%, rgba(255,255,255,.95), rgba(255,255,255,0) 70%)',
                  }}
                />
              </span>
              {/* colar (base da cabeça) */}
              <span
                className="absolute left-1/2 top-[15px] h-[6px] w-3 -translate-x-1/2 rounded-[50%_50%_45%_45%]"
                style={{
                  background: `linear-gradient(180deg, ${pal.pin[1]}, ${pal.pin[2]})`,
                  boxShadow: '0 2px 3px rgba(0,0,0,.28)',
                }}
              />
              {/* haste metálica entrando no papel */}
              <span
                className="absolute left-1/2 top-[19px] h-[10px] w-[2px] -translate-x-1/2 rounded-b-[1px]"
                style={{ background: 'linear-gradient(90deg,#9aa0a6,#d7dade 45%,#7d8288)' }}
              />
            </span>
          </button>
        </>
      )}

      {canManage && !editing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          aria-label={note.pinned ? 'Soltar nota do topo' : 'Fixar nota no topo'}
          title={note.pinned ? 'Soltar do topo' : 'Fixar no topo'}
          aria-pressed={note.pinned}
          className={cn(
            'absolute right-1.5 top-1.5 z-20 rounded p-1 transition-opacity duration-micro',
            // Fixada mostra sempre (é estado); solta só no hover (é ação).
            note.pinned ? 'opacity-70' : 'opacity-0 focus:opacity-100 group-hover/note:opacity-60',
          )}
          style={{ color: pal.text }}
        >
          <Pin size={13} fill={note.pinned ? 'currentColor' : 'none'} />
        </button>
      )}

      {editing ? (
        <div className="space-y-2">
          <textarea
            ref={areaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDraft(note.text);
                onStopEdit();
              }
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
            }}
            rows={3}
            maxLength={500}
            placeholder="Escreva…"
            className="w-full resize-none bg-transparent text-sm leading-snug outline-none placeholder:text-current placeholder:opacity-45"
            style={{ color: pal.text, caretColor: pal.text }}
          />
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                onMouseDown={(e) => {
                  // onMouseDown p/ não perder o foco do textarea antes do save
                  e.preventDefault();
                  if (c !== color) onSaveColor(c);
                }}
                aria-label={`Cor ${c}`}
                className={cn(
                  'h-4 w-4 rounded-full ring-offset-1 transition-transform duration-micro hover:scale-110',
                  c === color && 'ring-2 ring-black/25',
                )}
                style={{
                  background: `linear-gradient(160deg, ${NOTE_PALETTE[c].paper[1]}, ${NOTE_PALETTE[c].pin[1]})`,
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.12)',
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <p
          className="whitespace-pre-wrap break-words text-sm leading-snug"
          style={{ color: pal.text }}
        >
          {note.text || <span className="opacity-45">Nota vazia — toque para escrever</span>}
        </p>
      )}
    </div>
  );
}

/**
 * Gaveta de arquivadas — o que foi arrancado continua aqui. Restaurar devolve
 * ao mural; excluir some de vez, e é O ÚNICO lugar onde isso acontece (o
 * gesto rápido no mural nunca destrói nada).
 */
function ArchivedDrawer({
  open,
  onOpenChange,
  canManage,
  onRestore,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const archivedQ = useQuery({
    retry: false,
    enabled: open, // só busca quando a gaveta abre
    staleTime: 30 * 1000,
    queryKey: ['/workspace/notes', 'archived'],
    queryFn: async () =>
      (await apiClient.get<QuickNote[]>('/workspace/notes', { params: { archived: true } })).data,
  });

  const notes = archivedQ.data ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="sm">
        <SheetHeader>
          <SheetTitle>Notas arquivadas</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {archivedQ.isLoading ? (
            <ListSkeleton />
          ) : notes.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Nada arquivado"
              hint="As notas que você arrancar do mural ficam guardadas aqui."
            />
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => {
                const pal = NOTE_PALETTE[safeColor(n.color)];
                return (
                  <li
                    key={n.id}
                    className="flex items-start gap-2 rounded-lg border border-line p-2.5"
                  >
                    <span
                      aria-hidden
                      className="mt-0.5 h-8 w-1.5 shrink-0 rounded-full"
                      style={{ background: pal.pin[1] }}
                    />
                    <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-content">
                      {n.text || <span className="text-content-muted">Nota vazia</span>}
                    </p>
                    {canManage && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={() => onRestore(n.id)}
                          aria-label="Devolver ao mural"
                          title="Devolver ao mural"
                          className="rounded p-1.5 text-content-muted transition-colors duration-micro hover:text-content"
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          onClick={() => onDelete(n.id)}
                          aria-label="Excluir definitivamente"
                          title="Excluir definitivamente"
                          className="rounded p-1.5 text-content-muted transition-colors duration-micro hover:text-danger"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
