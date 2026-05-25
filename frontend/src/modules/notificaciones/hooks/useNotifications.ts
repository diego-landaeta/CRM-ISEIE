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
    try {
      const placeholder = {
        endpoint: 'local-only',
        createdAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
      };
      localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(placeholder));
      setIsSubscribed(true);
      return true;
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
