import { useEffect, useState } from 'react';
import { DownloadSimple, X, Share, Plus } from '@phosphor-icons/react';

const DISMISS_KEY = 'crm.pwa.dismissed_at';
const DISMISS_DAYS = 14;

function wasRecentlyDismissed() {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY));
    if (!ts) return false;
    return (Date.now() - ts) < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
}

export default function PwaInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [visible, setVisible] = useState(false);
  const [iosVisible, setIosVisible] = useState(false);

  useEffect(() => {
    // Registrar service worker en producción (HTTPS o localhost).
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js').catch(() => {/* silencioso */});
    }
  }, []);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;
    function onPrompt(e) {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS no soporta beforeinstallprompt → mostramos instrucción manual a los 8s.
    let iosTimer;
    if (isIOS()) {
      iosTimer = setTimeout(() => setIosVisible(true), 8000);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      if (iosTimer) clearTimeout(iosTimer);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    setVisible(false);
    if (choice?.outcome !== 'accepted') {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
    }
  }

  function dismiss() {
    setVisible(false);
    setIosVisible(false);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch {}
  }

  if (visible) {
    return (
      <div role="dialog" aria-label="Instalar app" className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-[80]">
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <DownloadSimple size={20} weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Instala el CRM en este dispositivo</h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">
              Acceso desde el escritorio o pantalla de inicio, sin barra de URL y con soporte offline básico.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={install}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <DownloadSimple size={12} weight="bold" />
                Instalar
              </button>
              <button
                onClick={dismiss}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >Ahora no</button>
            </div>
          </div>
          <button onClick={dismiss} className="flex-shrink-0 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X size={14} weight="bold" />
          </button>
        </div>
      </div>
    );
  }

  if (iosVisible) {
    return (
      <div role="dialog" aria-label="Instalar app en iOS" className="fixed bottom-4 left-4 right-4 sm:right-auto sm:max-w-sm z-[80]">
        <div className="bg-card border border-border rounded-2xl shadow-2xl p-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Share size={20} weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm">Añade el CRM a tu pantalla de inicio</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              En Safari, pulsa <Share size={11} className="inline" /> Compartir → <Plus size={11} className="inline" /> "Añadir a pantalla de inicio".
            </p>
          </div>
          <button onClick={dismiss} className="flex-shrink-0 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
            <X size={14} weight="bold" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
