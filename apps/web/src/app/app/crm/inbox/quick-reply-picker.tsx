'use client';

import { Store, User } from 'lucide-react';
import { QuickReply } from './inbox-types';

/**
 * Popup de respostas rápidas do composer (F3.5-C3 #553). Aparece quando o draft
 * começa com "/" — teclado (↑↓ + Tab/Enter) é tratado no textarea do inbox.
 */
export function QuickReplyPicker({
  matches,
  activeIndex,
  onPick,
}: {
  matches: QuickReply[];
  activeIndex: number;
  onPick: (reply: QuickReply) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 z-20 mb-1 max-h-56 overflow-y-auto rounded-md border bg-surface shadow-lg">
      <div className="border-b px-3 py-1.5 text-[11px] text-content-muted">
        Respostas rápidas: ↑↓ navega, Tab/Enter insere no rascunho
      </div>
      {matches.map((q, i) => (
        <button
          key={q.id}
          type="button"
          // onMouseDown p/ inserir antes do textarea perder o foco
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(q);
          }}
          className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-500/[0.06] ${
            i === activeIndex ? 'bg-neutral-500/[0.08]' : ''
          }`}
        >
          {q.ownerId ? (
            <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted" />
          ) : (
            <Store className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-muted" />
          )}
          <span className="min-w-0">
            <span className="font-medium">/{q.shortcut}</span>
            <span className="ml-2 text-xs text-content-muted">
              {q.ownerId ? 'pessoal' : 'loja'}
            </span>
            <span className="block truncate text-xs text-content-muted">{q.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
