import { apiClient } from './api-client';

/**
 * Web push do CRM (V2.1 #568) — helpers de opt-in/opt-out do dispositivo.
 * iOS Safari só suporta push com a PWA instalada (Add to Home Screen).
 */

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** iOS sem PWA instalada: push indisponível — a config mostra as instruções */
export function isIosWithoutPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/** Assinatura ativa deste navegador (null = sem opt-in aqui) */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Fluxo completo de opt-in: permissão → subscribe no navegador → registra na API */
export async function subscribeToPush(): Promise<'ok' | 'denied' | 'unsupported' | 'disabled'> {
  if (!isPushSupported()) return 'unsupported';

  const { data } = await apiClient.get<{ publicKey: string | null }>(
    '/notifications/push/public-key',
  );
  if (!data.publicKey) return 'disabled'; // servidor sem VAPID

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(data.publicKey) as BufferSource,
  });

  const json = sub.toJSON();
  await apiClient.post('/notifications/push/subscribe', {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    userAgent: navigator.userAgent,
  });
  return 'ok';
}

/** Opt-out deste dispositivo: desfaz no navegador e remove na API */
export async function unsubscribeFromPush(): Promise<boolean> {
  const sub = await getCurrentSubscription();
  if (!sub) return false;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await apiClient.delete('/notifications/push/subscribe', { data: { endpoint } });
  return true;
}
