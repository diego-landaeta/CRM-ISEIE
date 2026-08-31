import { useCallback, useEffect, useState } from 'react';
import {
  loadPreferences,
  savePreferences,
  shouldDeliver,
  type NotificationKind,
  type NotificationPreferences,
} from '../lib/preferences';

export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface UseNotificationsResult {
  permission: PermissionState;
  isSupported: boolean;
  isPushSupported: boolean;
  isSubscribed: boolean;
  prefs: NotificationPreferences;
  requestPermission: () => Promise<PermissionState>;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
  showLocal: (title: string, options?: NotificationOptions) => void;
  canDeliver: (kind: NotificationKind) => string[];
  updatePrefs: (next: NotificationPreferences) => void;
}

const SUBSCRIPTION_KEY = 'crm.push-subscription';

function readPermission(): PermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PermissionState;
}

export function useNotifications(): UseNotificationsResult {
  const [permission, setPermission] = useState<PermissionState>(() => readPermission());
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => loadPreferences());
  const [isSubscribed, setIsSubscribed] = useState<boolean>(() => {
    try { return !!localStorage.getItem(SUBSCRIPTION_KEY); } catch { return false; }
  });

  const isSupported = typeof window !== 'undefined' && 'Notification' in window;
  const isPushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window;

  useEffect(() => {
    function onChange() { setPrefs(loadPreferences()); }
    window.addEventListener('crm:notification-prefs-changed', onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener('crm:notification-prefs-changed', onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  const requestPermission = useCallback(async (): Promise<PermissionState> => {
    if (!isSupported) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);
      return result as PermissionState;
    } catch {
      return 'denied';
    }
  }, [isSupported]);

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported) return false;
    if (Notification.permission !== 'granted') {
      const next = await Notification.requestPermission();
      setPermission(next as PermissionState);
      if (next !== 'granted') return false;
    }
    // NO se marca como suscrita. Lo que habia aqui antes escribia un marcador en
    // el navegador y le decia a la gestora que estaba suscrita. No lo estaba:
    // `/api/push-subscriptions` no existe, no hay claves VAPID en ninguna parte y
    // nunca se registro nada en el servidor. Una pantalla que dice «activado»
    // sobre algo apagado es peor que una que dice «todavia no»: con la primera
    // nadie lo arregla, porque nadie sabe que esta roto.
    //
    // El permiso SI se pide arriba y SI sirve: con el CRM abierto, el aviso de un
    // mensaje de WhatsApp ya llega — lo hace AvisoDeMensaje, en el layout. Lo que
    // falta es el aviso con el CRM cerrado.
    //
    // Cuando exista el endpoint, aqui va:
    //   const reg = await navigator.serviceWorker.ready;
    //   const sub = await reg.pushManager.subscribe({
    //     userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY });
    //   await client.post('/push-subscriptions', sub);
    //   setIsSubscribed(true); return true;
    try {
      localStorage.removeItem(SUBSCRIPTION_KEY);
      setIsSubscribed(false);
      return false;
    } catch {
      return false;
    }
  }, [isPushSupported]);

  const unsubscribe = useCallback(async (): Promise<void> => {
    try {
      localStorage.removeItem(SUBSCRIPTION_KEY);
      setIsSubscribed(false);
    } catch { /* localStorage no disponible */ }
  }, []);

  const showLocal = useCallback((title: string, options: NotificationOptions = {}): void => {
    if (permission !== 'granted') return;
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        const iconPath = `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/iseie-icon-192.png`;
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, { badge: iconPath, icon: iconPath, ...options });
        });
      } else {
        new Notification(title, options);
      }
    } catch { /* gesture requerido en algunos browsers */ }
  }, [permission]);

  const canDeliver = useCallback(
    (kind: NotificationKind): string[] => shouldDeliver(prefs, kind),
    [prefs],
  );

  const updatePrefs = useCallback((next: NotificationPreferences): void => {
    setPrefs(next);
    savePreferences(next);
  }, []);

  return {
    permission,
    isSupported,
    isPushSupported,
    isSubscribed,
    prefs,
    requestPermission,
    subscribe,
    unsubscribe,
    showLocal,
    canDeliver,
    updatePrefs,
  };
}
