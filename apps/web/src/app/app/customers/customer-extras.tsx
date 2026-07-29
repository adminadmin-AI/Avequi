'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Plus, Tag, Trash2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';

/**
 * #476 — Tags de segmentação + anexos do cliente (docs de emplacamento: CNH,
 * comprovante de endereço que o fluxo ATPV-e/BIN pede ao despachante).
 * Montado no dialog de edição, igual ao CustomerAddresses.
 */

interface CustomerTag {
  id: string;
  name: string;
  color: string | null;
  _count?: { links: number };
}

interface TagLink {
  tagId: string;
  tag: CustomerTag;
}

interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

function fmtSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function CustomerExtras({ customerId }: { customerId: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [newTagName, setNewTagName] = useState('');

  // ── tags ────────────────────────────────────────────────────────────────────
  const { data: allTags = [] } = useQuery<CustomerTag[]>({
    queryKey: ['/customers/tags'],
    queryFn: async () => (await apiClient.get('/customers/tags')).data,
  });
  const { data: customer } = useQuery<{ tagLinks?: TagLink[] }>({
    queryKey: ['/customers', customerId],
    queryFn: async () => (await apiClient.get(`/customers/${customerId}`)).data,
  });
  const selected = new Set((customer?.tagLinks ?? []).map((l) => l.tagId));

  const setTags = useMutation({
    mutationFn: (tagIds: string[]) => apiClient.patch(`/customers/${customerId}/tags`, { tagIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/customers'] });
      qc.invalidateQueries({ queryKey: ['/customers', customerId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao salvar tags'),
  });

  const createTag = useMutation({
    mutationFn: (name: string) => apiClient.post('/customers/tags', { name }),
    onSuccess: async (res: any) => {
      qc.invalidateQueries({ queryKey: ['/customers/tags'] });
      setNewTagName('');
      // já vincula a tag recém-criada ao cliente
      setTags.mutate([...selected, res.data.id]);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao criar tag'),
  });

  function toggleTag(tagId: string) {
    const next = new Set(selected);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setTags.mutate([...next]);
  }

  // ── anexos ──────────────────────────────────────────────────────────────────
  const { data: attachments = [] } = useQuery<Attachment[]>({
    queryKey: ['/customers', customerId, 'attachments'],
    queryFn: async () => (await apiClient.get(`/customers/${customerId}/attachments`)).data,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiClient.post(`/customers/${customerId}/attachments`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/customers', customerId, 'attachments'] });
      toast.success('Anexo enviado');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro no upload (máx 10MB)'),
  });

  const removeAttachment = useMutation({
    mutationFn: (attachmentId: string) => apiClient.delete(`/customers/attachments/${attachmentId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['/customers', customerId, 'attachments'] });
      toast.success('Anexo removido');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erro ao remover anexo'),
  });

  async function download(att: Attachment) {
    // download autenticado — <a href> não manda o Bearer
    const res = await apiClient.get(`/customers/attachments/${att.id}`, { responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-4 space-y-4 border-t border-line pt-4">
      {/* Tags */}
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content-secondary">
          <Tag size={14} />
          Tags de segmentação
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTag(t.id)}
              disabled={setTags.isPending}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                selected.has(t.id)
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-line text-content-secondary hover:border-brand-600'
              }`}
            >
              {t.name}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <Input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="Nova tag…"
              className="h-7 w-32 text-xs"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (newTagName.trim()) createTag.mutate(newTagName.trim());
                }
              }}
            />
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={!newTagName.trim() || createTag.isPending}
              onClick={() => createTag.mutate(newTagName.trim())}
            >
              <Plus size={12} />
            </Button>
          </div>
        </div>
      </div>

      {/* Anexos */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium text-content-secondary">
            <Paperclip size={14} />
            Anexos (CNH, comprovante — emplacamento)
          </p>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="application/pdf,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
          <Button
            type="button"
            size="xs"
            variant="secondary"
            loading={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Plus size={12} />
            Anexar (máx 10MB)
          </Button>
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs text-content-muted">Nenhum anexo.</p>
        ) : (
          <ul className="space-y-1">
            {attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate text-content">
                  {att.filename}
                  <span className="ml-1.5 text-content-muted">({fmtSize(att.size)})</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => download(att)}
                    title="Baixar"
                    className="rounded p-1 text-content-muted hover:text-brand-600"
                  >
                    <Download size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeAttachment.mutate(att.id)}
                    title="Remover"
                    className="rounded p-1 text-content-muted hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
