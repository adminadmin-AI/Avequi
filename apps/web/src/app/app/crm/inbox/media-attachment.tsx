'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

/**
 * Mídia de mensagem WhatsApp. O proxy /crm/whatsapp/media/:id exige Bearer,
 * então <img src> direto não funciona — baixamos o blob autenticado e usamos
 * objectURL (revogado no unmount).
 */
export function MediaAttachment({
  messageId,
  type,
  mimeType,
}: {
  messageId: string;
  type: string;
  mimeType: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    apiClient
      .get(`/crm/whatsapp/media/${messageId}`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(res.data);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId]);

  if (error) {
    return <span className="text-xs text-muted-foreground italic">mídia indisponível</span>;
  }
  if (!url) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="carregando mídia" />;
  }

  if (type === 'IMAGE' || type === 'STICKER') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="imagem recebida" className="max-h-64 max-w-full rounded-lg" />;
  }
  if (type === 'AUDIO') {
    return <audio src={url} controls className="max-w-full" preload="metadata" />;
  }
  if (type === 'VIDEO') {
    return <video src={url} controls className="max-h-64 max-w-full rounded-lg" preload="metadata" />;
  }
  return (
    <a
      href={url}
      download
      className="inline-flex items-center gap-2 text-sm underline underline-offset-2"
    >
      <FileText className="h-4 w-4" />
      documento{mimeType ? ` (${mimeType.split('/')[1]})` : ''}
      <Download className="h-3.5 w-3.5" />
    </a>
  );
}
