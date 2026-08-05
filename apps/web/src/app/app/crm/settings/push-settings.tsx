'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { erroDeAcao } from '@/lib/feedback';
import {
  getCurrentSubscription,
  isIosWithoutPwa,
  isPushSupported,
  registerServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
} from '@/lib/push';

/**
 * CRM V2.1 (#568) — toggle de web push DESTE dispositivo (opt-in por navegador,
 * qualquer usuário) + instruções de instalação da PWA. iOS Safari só recebe
 * push com o app instalado na tela inicial.
 */
export function PushSettings() {
  const toast = useToast();
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'unsupported'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!isPushSupported() || isIosWithoutPwa()) {
        setState('unsupported');
        return;
      }
      await registerServiceWorker();
      const sub = await getCurrentSubscription();
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  const toggle = async (checked: boolean) => {
    setBusy(true);
    try {
      if (checked) {
        const result = await subscribeToPush();
        if (result === 'ok') {
          setState('on');
          toast.success('Push ativado neste dispositivo');
        } else if (result === 'denied') {
          toast.error('Permissão negada. Libere as notificações nas configurações do navegador.');
        } else if (result === 'disabled') {
          toast.error('Push desativado no servidor (VAPID não configurado)');
        }
      } else {
        await unsubscribeFromPush();
        setState('off');
        toast.info('Push desativado neste dispositivo');
      }
    } catch (e) {
      toast.error(erroDeAcao('alterar as notificações push', e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">🔔 Notificações push (este dispositivo)</h2>
        {state === 'loading' ? (
          <Loader2 className="h-4 w-4 animate-spin text-content-muted" />
        ) : state === 'unsupported' ? (
          <span className="text-xs text-content-muted">indisponível neste navegador</span>
        ) : (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={state === 'on'}
              disabled={busy}
              onChange={(e) => toggle(e.target.checked)}
            />
            {state === 'on' ? 'Ligado' : 'Desligado'}
          </label>
        )}
      </div>
      <p className="text-xs text-content-muted">
        Lead novo, lead quente da IA, lembrete vencido e cliente sem resposta chegam no
        celular mesmo com o app fechado. O opt-in é por dispositivo. Ative em cada
        aparelho que usar.
      </p>
      <details className="text-xs text-content-muted">
        <summary className="cursor-pointer font-medium text-content">
          📱 Como instalar o app no celular (recomendado)
        </summary>
        <div className="mt-2 space-y-2">
          <p>
            <strong>Android (Chrome):</strong> abra o Avequi no navegador → menu ⋮ →{' '}
            <em>&quot;Adicionar à tela inicial&quot;</em> (ou &quot;Instalar app&quot;) → confirme. As
            notificações funcionam no navegador ou no app instalado.
          </p>
          <p>
            <strong>iPhone/iPad (Safari):</strong> abra o Avequi no Safari → botão
            compartilhar (quadrado com seta) → <em>&quot;Adicionar à Tela de Início&quot;</em> →
            confirme. <strong>No iOS o push SÓ funciona pelo app instalado.</strong> Depois de
            instalar, abra pelo ícone e ative o toggle acima.
          </p>
        </div>
      </details>
    </section>
  );
}
