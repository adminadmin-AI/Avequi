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

/**
 * Arrastar-para-reordenar do mural de notas — módulo carregado via
 * next/dynamic (mesmo padrão do modo edição e do recharts): o dnd-kit não
 * entra no chunk inicial da rota /app, só baixa quando existe mural com
 * mais de uma nota para ordenar.
 *
 * O post-it em si continua no widget e é passado como children — isto aqui
 * é só o encanamento de arraste, para o papel renderizar de imediato.
 */

export function NotesDndBoard({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (activeId: string, overId: string) => void;
  children: (id: string) => ReactNode;
}) {
  // 5px de folga: clicar no papel abre a edição, arrastar move — o mesmo
  // gesto não pode fazer as duas coisas.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="flex flex-wrap gap-x-5 gap-y-6 pt-2">
          {ids.map((id) => (
            <SortableNote key={id} id={id}>
              {children(id)}
            </SortableNote>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableNote({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // A nota arrastada sobe de plano e perde um pouco de opacidade — o
      // resto do mural continua legível por baixo.
      className={isDragging ? 'z-20 opacity-70' : undefined}
    >
      {children}
    </div>
  );
}
