'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Plus, Store, Trash2, User, X } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { QuickReply } from '../inbox/inbox-types';

const MANAGER_ROLES = ['SUPER_ADMIN', 'DIRECTOR', 'MANAGER'];

interface FormState {
  id: string | null; // null = criando
  shortcut: string;
  text: string;
  scope: 'STORE' | 'PERSONAL';
}

const EMPTY_FORM: FormState = { id: null, shortcut: '', text: '', scope: 'PERSONAL' };

/**
 * Gestão de respostas rápidas (F3.5-C3 #553). Da loja = compartilhadas (gerente);
 * minhas = pessoais do vendedor. No inbox: "/" lista, Tab/Enter insere no rascunho.
 */
export default function QuickRepliesPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);

  const isManager = MANAGER_ROLES.includes(user?.role ?? '');

  const { data: replies = [], isLoading } = useQuery<QuickReply[]>({
    queryKey: ['crm-quick-replies'],
    queryFn: async () => (await apiClient.get('/crm/quick-replies')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['crm-quick-replies'] });

  const save = useMutation({
    mutationFn: (f: FormState) =>
      f.id
        ? apiClient.patch(`/crm/quick-replies/${f.id}`, { shortcut: f.shortcut, text: f.text })
        : apiClient.post('/crm/quick-replies', { shortcut: f.shortcut, text: f.text, scope: f.scope }),
    onSuccess: () => {
      invalidate();
      setForm(null);
      toast.success('Resposta rápida salva');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao salvar'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/crm/quick-replies/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success('Resposta excluída');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Falha ao excluir'),
  });

  const storeReplies = replies.filter((r) => r.ownerId == null);
  const myReplies = replies.filter((r) => r.ownerId === user?.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Respostas rápidas"
        description='Atalhos do inbox: digite "/" na conversa e Tab insere o texto (editável antes de enviar). Use {nome} p/ o primeiro nome do lead.'
      />

      <div>
        <Button onClick={() => setForm({ ...EMPTY_FORM, scope: isManager ? 'STORE' : 'PERSONAL' })}>
          <Plus className="mr-1 h-4 w-4" />
          Nova resposta
        </Button>
      </div>

      {form && (
        <section className="surface-sheen space-y-3 rounded-xl bg-surface p-4 shadow-soft">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">{form.id ? 'Editar resposta' : 'Nova resposta'}</h2>
            <button onClick={() => setForm(null)} aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <label className="block">
              <span className="mb-1 block text-xs text-content-muted">Atalho</span>
              <div className="flex items-center gap-1">
                <span className="text-sm text-content-muted">/</span>
                <input
                  className="w-full rounded-md border bg-surface px-2 py-2 text-sm"
                  placeholder="pix"
                  maxLength={30}
                  value={form.shortcut}
                  onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                />
              </div>
            </label>
            {!form.id && (
              <label className="block">
                <span className="mb-1 block text-xs text-content-muted">Escopo</span>
                <select
                  className="w-full rounded-md border bg-surface px-2 py-2 text-sm sm:w-64"
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value as FormState['scope'] })}
                >
                  <option value="PERSONAL">Pessoal (só eu vejo)</option>
                  {isManager && <option value="STORE">Loja (todos os vendedores)</option>}
                </select>
              </label>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-content-muted">Texto</span>
            <textarea
              className="min-h-24 w-full rounded-md border bg-surface p-2 text-sm"
              placeholder="Olá {nome}! Nossa chave PIX é o CNPJ 00.000.000/0001-00"
              maxLength={4000}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
            />
          </label>
          <Button
            onClick={() => save.mutate(form)}
            disabled={save.isPending || !form.shortcut.trim() || !form.text.trim()}
          >
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </section>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-content-muted" />
        </div>
      )}

      {!isLoading && replies.length === 0 && !form && (
        <EmptyState
          icon={Store}
          title="Nenhuma resposta rápida"
          description="Crie atalhos p/ as perguntas que você responde toda hora (PIX, endereço, frete...)."
        />
      )}

      {storeReplies.length > 0 && (
        <ReplySection
          title="Da loja"
          icon={<Store className="h-4 w-4" />}
          replies={storeReplies}
          canEdit={() => isManager}
          onEdit={(r) => setForm({ id: r.id, shortcut: r.shortcut, text: r.text, scope: 'STORE' })}
          onDelete={(r) => remove.mutate(r.id)}
        />
      )}

      {myReplies.length > 0 && (
        <ReplySection
          title="Minhas (pessoais)"
          icon={<User className="h-4 w-4" />}
          replies={myReplies}
          canEdit={() => true}
          onEdit={(r) => setForm({ id: r.id, shortcut: r.shortcut, text: r.text, scope: 'PERSONAL' })}
          onDelete={(r) => remove.mutate(r.id)}
        />
      )}
    </div>
  );
}

function ReplySection({
  title,
  icon,
  replies,
  canEdit,
  onEdit,
  onDelete,
}: {
  title: string;
  icon: React.ReactNode;
  replies: QuickReply[];
  canEdit: (r: QuickReply) => boolean;
  onEdit: (r: QuickReply) => void;
  onDelete: (r: QuickReply) => void;
}) {
  return (
    <section className="surface-sheen rounded-xl bg-surface shadow-soft">
      <h2 className="flex items-center gap-2 border-b p-3 text-sm font-medium">
        {icon}
        {title}
        <Badge variant="neutral" className="text-[10px]">
          {replies.length}
        </Badge>
      </h2>
      <ul className="divide-y">
        {replies.map((r) => (
          <li key={r.id} className="flex items-start gap-3 p-3">
            <code className="shrink-0 rounded bg-neutral-500/[0.08] px-1.5 py-0.5 text-xs">/{r.shortcut}</code>
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-content-muted">
              {r.text}
            </p>
            {canEdit(r) && (
              <span className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => onEdit(r)} aria-label="Editar">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => onDelete(r)}
                  aria-label="Excluir"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
