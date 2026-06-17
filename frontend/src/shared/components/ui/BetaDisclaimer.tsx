import { useEffect, useState } from 'react';
import { WarningCircle, X } from '@phosphor-icons/react';

interface Props {
  sectionKey: string;       // 'finanzas', 'soporte', etc — usado para localStorage
  title?: string;
  description: string;
  showOncePerSession?: boolean;
}

// Popup informativo de "zona en pruebas" que aparece la PRIMERA vez que
// entrás a una sección (por session/día). Después queda como banner arriba.
export default function BetaDisclaimer({
  sectionKey,
  title = 'Sección en pruebas',
  description,
  showOncePerSession = true,
}: Props) {
  const storageKey = `beta-seen-${sectionKey}-${new Date().toISOString().slice(0, 10)}`;
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!showOncePerSession) {
      setShowModal(true);
      return;
    }
    try {
      const seen = localStorage.getItem(storageKey);
      if (!seen) setShowModal(true);
    } catch {
      setShowModal(true);
    }
  }, [storageKey, showOncePerSession]);

  function close() {
    setShowModal(false);
    try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
  }

  return (
    <>
      {/* Banner permanente arriba */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900 px-4 py-2 flex items-center gap-2 text-xs">
        <WarningCircle size={14} weight="fill" className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <span className="font-semibold text-amber-900 dark:text-amber-300">EN PRUEBAS</span>
        <span className="text-amber-800 dark:text-amber-400 truncate">
          · {description}
        </span>
      </div>

      {/* Popup modal — primera vez */}
      {showModal && (
        <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-card rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-border flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
                <WarningCircle size={22} weight="duotone" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base">{title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Solo para superadmin/admin/soporte</p>
              </div>
              <button onClick={close} className="p-1 text-muted-foreground hover:text-foreground"><X size={16} /></button>
            </div>
            <div className="p-5 text-sm space-y-3">
              <p>{description}</p>
              <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                <li>Los datos son <strong>reales</strong>, pero algunos automatismos siguen en validación.</li>
                <li>Si encontrás algo que no cuadra, reportalo via solicitudes de cambio.</li>
                <li>Este aviso vuelve a aparecer cada día.</li>
              </ul>
            </div>
            <div className="p-3 border-t border-border flex justify-end bg-muted/20">
              <button onClick={close}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
