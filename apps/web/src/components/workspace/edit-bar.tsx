'use client';

import { Check, Eye, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WidgetId } from './types';
import { WIDGET_META } from './widget-meta';

/**
 * Controles leves do modo edição (F2) — SEM dnd-kit neste módulo, de
 * propósito: isto entra no chunk inicial da rota /app; o maquinário de
 * drag (edit-mode.tsx) só chega via next/dynamic quando o usuário
 * clica em "Personalizar".
 */

export function EditBar({
  editing,
  canEdit,
  onToggle,
  onReset,
}: {
  editing: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onReset: () => void;
}) {
  if (!canEdit) return null;
  return (
    <div className="flex items-center justify-end gap-2">
      {editing && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw size={14} /> Restaurar padrão
        </Button>
      )}
      <Button variant={editing ? 'primary' : 'ghost'} size="sm" onClick={onToggle}>
        {editing ? (
          <>
            <Check size={14} /> Concluído
          </>
        ) : (
          <>
            <SlidersHorizontal size={14} /> Personalizar
          </>
        )}
      </Button>
    </div>
  );
}

/** Bandeja de widgets ocultos — só existe no modo edição. */
export function HiddenTray({ ids, onShow }: { ids: WidgetId[]; onShow: (id: WidgetId) => void }) {
  if (ids.length === 0) return null;
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-3">
      <p className="mb-2 text-helper font-medium uppercase tracking-wide text-content-muted">
        Ocultos
      </p>
      <div className="flex flex-wrap gap-2">
        {ids.map((id) => (
          <button
            key={id}
            onClick={() => onShow(id)}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-caption text-content-secondary transition-colors hover:text-content"
          >
            <Eye size={13} /> {WIDGET_META[id].title}
          </button>
        ))}
      </div>
    </div>
  );
}
