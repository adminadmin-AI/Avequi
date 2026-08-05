'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';
import {
  getCurrentSubscription,
  isIosWithoutPwa,
  isPushSupported,
  registerServiceWorker,
  subscribeToPush,
} from '@/lib/push';

const DISMISS_KEY = 'crm-push-banner-dismissed';

/**
 * Opt-in discreto de web push no inbox (CRM V2.1 #568). Some quando: já assinado,
 * permissão negada, sem suporte (iOS fora da PWA) ou dispensado pelo vendedor.
 */
export function PushBanner() {
  const toast = useToast();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isPushSupported() || isIosWithoutPwa()) return;
      if (Notification.permission === 'denied') return;
      if (localStorage.getItem(DISMISS_KEY)) return;
      await registerServiceWorker(); // mantém o SW vivo p/ assinaturas existentes
      const sub = await getCurrentSubscription();
      if (!sub) setVisible(true);
    })().catch(() => undefined);
  }, []);

  if (!visible) return null;

  const activate = async () => {
    setBusy(true);
    try {
      const result = await subscribeToPush();
      if (result === 'ok') {
        toast.success('Notificações ativadas. Você recebe lead novo no celular.');
        setVisible(false);
      } else if (result === 'denied') {
        toast.error('Permissão negada no navegador');
        setVisible(false);
      } else {
        toast.info('Push indisponível no servidor. Avise o suporte.');
        setVisible(false);
      }
    } catch (e) {
      toast.error(erroDeAcao('ativar as notificações', e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b bg-brand/5 px-3 py-2 text-xs">
      <Bell className="h-4 w-4 shrink-0 text-brand" />
      <span className="min-w-0 flex-1">
        Ative as notificações e receba lead novo direto no celular.
      </span>
      <button
        onClick={activate}
        disabled={busy}
        className="shrink-0 rounded-md bg-brand px-2 py-1 font-medium text-white disabled:opacity-50"
      >
        Ativar
      </button>
      <button
        aria-label="Dispensar"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setVisible(false);
        }}
        className="shrink-0 text-content-muted"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
