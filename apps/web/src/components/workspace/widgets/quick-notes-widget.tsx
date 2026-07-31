'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, StickyNote } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { usePermission } from '@/hooks/use-permission';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import { NOTE_COLORS, NOTE_PALETTE, safeColor, tiltFor, type NoteColor } from '../quick-notes';

/**
 * Notas rápidas — post-its pessoais (ideia do Claudio, 31/07). O ÚNICO lugar
 * onde o esqueumorfismo é honesto: papel + alfinete de ponta vermelha para
 * anotações que o próprio usuário cria e ARRANCA. Puxar o alfinete = resolvido:
 * o post-it levanta, gira e cai com opacidade — a satisfação de tirar da lista.
 *
 * Persistência real: GET/POST/PATCH/DELETE /workspace/notes (privado por
 * usuário). Edição/criação gateadas por workspace.notes.manage; sem a
 * permissão o painel é só leitura.
 */

interface QuickNote {
  id: string;
  text: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

const REMOVE_MS = 460;

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

  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['/workspace/notes'] });

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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<QuickNote, 'text' | 'color'>> }) =>
      apiClient.patch(`/workspace/notes/${id}`, patch),
    onSuccess: invalidate,
    onError,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/workspace/notes/${id}`),
    onSuccess: invalidate,
    onError,
  });

  const notes = notesQ.data ?? [];

  function pullPin(id: string) {
    if (removing.has(id)) return;
    setRemoving((prev) => new Set(prev).add(id));
    window.setTimeout(() => deleteM.mutate(id), REMOVE_MS);
  }

  // Sair da edição: nota que ficou vazia é removida (não polui o mural); com
  // texto, salva só se mudou.
  function commitText(note: QuickNote, raw: string) {
    const text = raw.trim();
    if (text === '') {
      deleteM.mutate(note.id);
      return;
    }
    if (text !== note.text) updateM.mutate({ id: note.id, patch: { text } });
  }

  const addNote = () => createM.mutate({ text: '', color: 'yellow' });

  return (
    <WidgetFrame
      title="Notas rápidas"
      badge={notes.length}
      action={
        canManage && notes.length > 0 ? (
          <button
            onClick={addNote}
            className="flex items-center gap-1 text-caption font-medium text-brand-600 transition-colors duration-micro hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            <Plus size={14} /> Nova nota
          </button>
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
            <button
              onClick={addNote}
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-3 py-1.5 text-caption font-medium text-content-secondary transition-colors duration-micro hover:border-brand-400 hover:text-brand-600 dark:hover:border-brand-600 dark:hover:text-brand-400"
            >
              <Plus size={14} /> Fixar primeira nota
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-3">
          {notes.map((n) => (
            <PostIt
              key={n.id}
              note={n}
              removing={removing.has(n.id)}
              editing={editingId === n.id}
              canManage={canManage}
              onEdit={() => canManage && setEditingId(n.id)}
              onStopEdit={() => setEditingId((cur) => (cur === n.id ? null : cur))}
              onSaveColor={(color) => updateM.mutate({ id: n.id, patch: { color } })}
              onCommitText={(text) => commitText(n, text)}
              onPull={() => pullPin(n.id)}
            />
          ))}
        </div>
      )}
    </WidgetFrame>
  );
}

function PostIt({
  note,
  removing,
  editing,
  canManage,
  onEdit,
  onStopEdit,
  onSaveColor,
  onCommitText,
  onPull,
}: {
  note: QuickNote;
  removing: boolean;
  editing: boolean;
  canManage: boolean;
  onEdit: () => void;
  onStopEdit: () => void;
  onSaveColor: (color: NoteColor) => void;
  onCommitText: (text: string) => void;
  onPull: () => void;
}) {
  const color = safeColor(note.color);
  const pal = NOTE_PALETTE[color];
  const tilt = tiltFor(note.id);
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
    ...(removing
      ? { transform: 'translateY(-10px) rotate(12deg) scale(0.9)' }
      : { ['--note-tilt' as string]: `${tilt}deg` }),
  } as CSSProperties;

  return (
    <div
      onClick={() => !editing && canManage && onEdit()}
      className={cn(
        'quick-note relative min-h-[112px] rounded-[2px_2px_3px_2px] px-4 pb-4 pt-6',
        !editing && canManage && 'cursor-text',
        // fade-in anima só opacidade (sem transform) — não briga com o tilt
        removing ? 'z-10 opacity-0 transition-all duration-[460ms] ease-flow' : 'animate-in fade-in duration-flow',
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
              onPull();
            }}
            aria-label="Arrancar nota"
            title="Arrancar nota"
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
