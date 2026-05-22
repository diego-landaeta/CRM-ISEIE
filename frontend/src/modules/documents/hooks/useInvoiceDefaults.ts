import { useCallback, useEffect, useState } from 'react';

export interface InvoiceEmisor {
  emisor_nombre: string;
  emisor_nif: string;
  emisor_direccion: string;
  emisor_telefono: string;
  iva_pct: number;
  notas: string;
}

const STORAGE_PREFIX = 'crm.invoice-defaults.';

const FALLBACK: InvoiceEmisor = {
  emisor_nombre: '',
  emisor_nif: '',
  emisor_direccion: '',
  emisor_telefono: '',
  iva_pct: 21,
  notas: '',
};

function storageKey(projectId: number | string | null | undefined): string {
  return `${STORAGE_PREFIX}${projectId ?? 'global'}`;
}

/**
 * Persiste los datos del emisor + IVA + notas bancarias por proyecto en
 * localStorage. Auto-rellena en el form para que el usuario no reescriba cada vez.
 *
 * Resolución:
 *  1. Defaults del proyecto activo (si existen)
 *  2. Defaults globales (último valor guardado en cualquier proyecto)
 *  3. FALLBACK vacío
 */
export function useInvoiceDefaults(projectId: number | null | undefined) {
  const [defaults, setDefaults] = useState<InvoiceEmisor>(() => loadDefaults(projectId));

  useEffect(() => {
    setDefaults(loadDefaults(projectId));
  }, [projectId]);

  const save = useCallback((next: Partial<InvoiceEmisor>): void => {
    const merged = { ...defaults, ...next };
    setDefaults(merged);
    try {
      localStorage.setItem(storageKey(projectId), JSON.stringify(merged));
      // Backup global = último valor escrito en cualquier proyecto
      localStorage.setItem(storageKey(null), JSON.stringify(merged));
    } catch {}
  }, [defaults, projectId]);

  const reset = useCallback((): void => {
    try {
      localStorage.removeItem(storageKey(projectId));
    } catch {}
    setDefaults(loadDefaults(null));
  }, [projectId]);

  return { defaults, save, reset };
}

function loadDefaults(projectId: number | null | undefined): InvoiceEmisor {
  try {
    if (projectId != null) {
      const projectRaw = localStorage.getItem(storageKey(projectId));
      if (projectRaw) {
        const parsed = JSON.parse(projectRaw);
        return { ...FALLBACK, ...parsed };
      }
    }
    const globalRaw = localStorage.getItem(storageKey(null));
    if (globalRaw) {
      const parsed = JSON.parse(globalRaw);
      return { ...FALLBACK, ...parsed };
    }
  } catch {}
  return FALLBACK;
}
