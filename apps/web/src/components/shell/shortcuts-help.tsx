'use client';

import { useUiStore } from '@/stores/ui-store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
} from '@/components/ui/dialog';

/**
 * Modal de atalhos de teclado — F8.2 (#325). Abre com Ctrl+/.
 */

const GROUPS: { title: string; items: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Geral',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Command palette (buscar páginas e ações)' },
      { keys: ['Ctrl', 'B'], label: 'Recolher/expandir a sidebar' },
      { keys: ['Ctrl', '/'], label: 'Este painel de atalhos' },
      { keys: ['Esc'], label: 'Fechar modais e menus' },
      { keys: ['Tab'], label: 'Navegar entre controles (e "Pular para o conteúdo")' },
    ],
  },
  {
    title: 'Ir para (pressione G e depois a tecla)',
    items: [
      { keys: ['G', 'H'], label: 'Início (dashboard)' },
      { keys: ['G', 'P'], label: 'Produtos' },
      { keys: ['G', 'C'], label: 'Clientes' },
      { keys: ['G', 'V'], label: 'Ordens de Venda' },
      { keys: ['G', 'O'], label: 'Ordens de Produção' },
      { keys: ['G', 'F'], label: 'Documentos Fiscais' },
    ],
  },
  {
    title: 'Em listas e menus',
    items: [
      { keys: ['↑', '↓'], label: 'Navegar itens (menus, combobox, palette)' },
      { keys: ['Enter'], label: 'Selecionar item destacado' },
      { keys: ['←', '→'], label: 'Alternar abas (Tabs)' },
    ],
  },
];

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-6 items-center justify-center rounded border border-line bg-surface-secondary px-1.5 py-0.5 text-caption font-medium text-content-secondary">
      {children}
    </kbd>
  );
}

export function ShortcutsHelp() {
  const { shortcutsOpen, setShortcutsOpen } = useUiStore();

  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription>Produtividade para usuários avançados.</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-6">
          <div className="space-y-5">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <p className="mb-2 text-caption font-semibold uppercase tracking-wide text-content-muted">
                  {g.title}
                </p>
                <ul className="space-y-1.5">
                  {g.items.map((item) => (
                    <li key={item.label} className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-content-secondary">{item.label}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {item.keys.map((k, i) => (
                          <Key key={i}>{k}</Key>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
