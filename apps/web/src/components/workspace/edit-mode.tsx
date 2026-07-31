'use client';

import type { ReactNode } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EyeOff, GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WidgetId, WidgetSize } from './types';
import { WIDGET_META } from './widget-meta';

/**
 * Maquinário de drag do modo edição (F2) — módulo carregado via next/dynamic
 * (o dnd-kit fica fora do chunk inicial da rota /app, mesmo padrão do #323
 * para o recharts). Personalização RESTRINGIDA de propósito: arrastar (só
 * zonas work/context), ocultar, e tamanho por preset half/full — nada de
 * resize livre por pixel.
 */

export function EditSurface({
  sortableIds,
  onReorder,
  children,
}: {
  sortableIds: WidgetId[];
  onReorder: (activeId: WidgetId, overId: WidgetId) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(active.id as WidgetId, over.id as WidgetId);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

interface ShellProps {
  id: WidgetId;
  size: WidgetSize;
  sortable: boolean;
  onHide: (id: WidgetId) => void;
  onResize: (id: WidgetId, size: WidgetSize) => void;
  children: ReactNode;
}

/** Moldura de edição: controles no topo, conteúdo inerte durante a edição. */
export function EditableShell({ id, size, sortable, onHide, onResize, children }: ShellProps) {
  const meta = WIDGET_META[id];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Limites da grid visíveis durante a edição: contorno tracejado em cada
      // célula; a que está sendo arrastada troca para o tom da marca.
      className={cn(
        'relative h-full rounded-xl outline-dashed outline-1 -outline-offset-1',
        isDragging ? 'z-10 opacity-80 outline-brand-400' : 'outline-line',
      )}
    >
      <div className="absolute -top-2.5 right-3 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-surface px-1 py-0.5 shadow-soft">
        {sortable && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab rounded p-1 text-content-muted hover:text-content active:cursor-grabbing"
            aria-label={`Mover ${meta.title}`}
          >
            <GripVertical size={14} />
          </button>
        )}
        {meta.sizes.length > 1 && (
          <button
            onClick={() => onResize(id, size === 'full' ? 'half' : 'full')}
            className="rounded p-1 text-content-muted hover:text-content"
            aria-label={size === 'full' ? `Reduzir ${meta.title}` : `Expandir ${meta.title}`}
          >
            {size === 'full' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        )}
        <button
          onClick={() => onHide(id)}
          className="rounded p-1 text-content-muted hover:text-danger"
          aria-label={`Ocultar ${meta.title}`}
        >
          <EyeOff size={14} />
        </button>
      </div>
      <div className="pointer-events-none h-full select-none">{children}</div>
    </div>
  );
}
