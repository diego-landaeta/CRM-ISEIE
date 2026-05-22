import { useEffect, useState } from 'react';
import { WifiSlash, CheckCircle } from '@phosphor-icons/react';

export default function OfflineBanner() {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
      setJustReconnected(true);
      setTimeout(() => setJustReconnected(false), 3500);
    }
    function goOffline() {
      setOnline(false);
      setJustReconnected(false);
    }
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online && !justReconnected) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-2 px-3 py-2 rounded-full text-xs font-medium shadow-lg border ${
        online
          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
          : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
      }`}
    >
      {online ? <CheckCircle size={13} weight="fill" /> : <WifiSlash size={13} weight="bold" />}
      {online ? 'Conexión restaurada' : 'Sin conexión a Internet'}
    </div>
  );
}
