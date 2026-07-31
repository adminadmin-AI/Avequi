'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, StickyNote } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { usePermission } from '@/hooks/use-permission';
import { cn } from '@/lib/utils';
import type { WidgetComponentProps } from '../types';
import { EmptyState, ListSkeleton, WidgetFrame } from '../widget-frame';
import { NOTE_COLORS, NOTE_STYLE, safeColor, tiltFor, type NoteColor } from '../quick-notes';

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

  const createM = useMutation({
    mutationFn: (body: { text: string; color: NoteColor }) =>
      apiClient.post<QuickNote>('/workspace/notes', body).then((r) => r.data),
    onSuccess: (note) => {
      invalidate();
      setEditingId(note.id); // já abre a nota nova para digitar
    },
  });
  const updateM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<QuickNote, 'text' | 'color'>> }) =>
      apiClient.patch(`/workspace/notes/${id}`, patch),
    onSuccess: invalidate,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/workspace/notes/${id}`),
    onSuccess: invalidate,
  });

  const notes = notesQ.data ?? [];

  function pullPin(id: string) {
    if (removing.has(id)) return;
    setRemoving((prev) => new Set(prev).add(id));
    window.setTimeout(() => deleteM.mutate(id), REMOVE_MS);
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
              onSave={(patch) => updateM.mutate({ id: n.id, patch })}
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
  onSave,
  onPull,
}: {
  note: QuickNote;
  removing: boolean;
  editing: boolean;
  canManage: boolean;
  onEdit: () => void;
  onStopEdit: () => void;
  onSave: (patch: Partial<Pick<QuickNote, 'text' | 'color'>>) => void;
  onPull: () => void;
}) {
  const color = safeColor(note.color);
  const style = NOTE_STYLE[color];
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
    const next = draft.trim();
    if (next !== note.text) onSave({ text: next });
  }

  return (
    <div
      className={cn(
        'relative transition-all ease-flow',
        removing
          ? 'z-10 -translate-y-2 rotate-12 scale-90 opacity-0 duration-[460ms]'
          : 'duration-flow animate-in fade-in zoom-in-95',
      )}
      style={{ transform: removing ? undefined : `rotate(${tilt}deg)` }}
    >
      {/* Alfinete de ponta vermelha — puxar = resolver. Fica acima do papel. */}
      {canManage && (
        <button
          onClick={onPull}
          aria-label="Arrancar nota"
          title="Arrancar nota"
          className="group absolute -top-2 left-1/2 z-20 -translate-x-1/2 focus:outline-none"
        >
          <span className="block transition-transform duration-fast ease-orbital group-hover:-translate-y-0.5 group-active:translate-y-0.5">
            {/* corpo metálico */}
            <span className="mx-auto block h-2 w-2 rounded-full bg-gradient-to-b from-danger-400 to-danger-600 shadow-elevation-2 ring-1 ring-black/10" />
            {/* haste */}
            <span className="mx-auto block h-2 w-px bg-neutral-400/70 dark:bg-neutral-500/70" />
          </span>
        </button>
      )}

      <div
        onClick={() => !editing && canManage && onEdit()}
        className={cn(
          'min-h-[92px] rounded-[3px] border-b-2 px-2.5 pb-2 pt-3.5 shadow-soft transition-shadow duration-flow',
          style.paper,
          style.edge,
          !editing && canManage && 'cursor-text hover:shadow-elevation-2',
        )}
      >
        {editing ? (
          <div className="space-y-2">
            <textarea
              ref={areaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
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
              className="w-full resize-none bg-transparent text-sm leading-snug text-content outline-none placeholder:text-content-muted"
            />
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              {NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  onMouseDown={(e) => {
                    // onMouseDown p/ não perder o foco do textarea antes do save
                    e.preventDefault();
                    if (c !== color) onSave({ color: c });
                  }}
                  aria-label={`Cor ${c}`}
                  className={cn(
                    'h-4 w-4 rounded-full border transition-transform duration-micro hover:scale-110',
                    NOTE_STYLE[c].paper,
                    NOTE_STYLE[c].edge,
                    c === color && 'ring-2 ring-content/30 ring-offset-1 ring-offset-surface',
                  )}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-snug text-content">
            {note.text || <span className="text-content-muted">Nota vazia — toque para escrever</span>}
          </p>
        )}
      </div>
    </div>
  );
}
