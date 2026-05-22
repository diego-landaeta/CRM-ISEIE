import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Sincroniza estado de filtros con URL search params.
 * Permite que refresh, copy/paste de URL y back/forward conserven el estado.
 *
 * Uso:
 *   const [filters, setFilters] = useUrlFilters({
 *     status: 'all',
 *     from: '',
 *     responsable: '',
 *   });
 *   filters.status              // valor actual (string)
 *   setFilters({ status: 'nuevo' })  // patch parcial; se omite del URL si === default
 *   setFilters.reset()          // limpia todos los params
 *
 * Convenciones:
 *  - Solo strings y números primitivos. Para arrays: serialízalos como CSV ("a,b,c").
 *  - Valor === default → no aparece en la URL (URLs limpias).
 *  - Cambios via setFilters() reemplazan el history entry actual (replace=true) — refresh-safe.
 */

export type UrlFilterDefaults = Record<string, string | number>;

export interface UrlFilterSetter<T extends UrlFilterDefaults> {
  (patch: Partial<T>): void;
  reset: () => void;
}

export default function useUrlFilters<T extends UrlFilterDefaults>(defaults: T): [T, UrlFilterSetter<T>] {
  const [searchParams, setSearchParams] = useSearchParams();

  // Estado actual leído del URL, con defaults
  const filters = useMemo(() => {
    const out = {} as Record<string, string | number>;
    for (const [key, def] of Object.entries(defaults)) {
      const fromUrl = searchParams.get(key);
      if (fromUrl == null) {
        out[key] = def;
      } else if (typeof def === 'number') {
        const n = Number(fromUrl);
        out[key] = Number.isFinite(n) ? n : def;
      } else {
        out[key] = fromUrl;
      }
    }
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, JSON.stringify(defaults)]);

  // Setter parcial: aplica patch y omite los que igualan default
  const setFilters = useCallback((patch: Partial<T>): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      const merged = { ...filters, ...patch } as Record<string, string | number>;
      for (const [key, def] of Object.entries(defaults)) {
        const value = merged[key];
        const isDefault = value === def || value === '' || value == null;
        if (isDefault) {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      }
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [filters, setSearchParams, defaults]);

  const reset = useCallback((): void => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of Object.keys(defaults)) next.delete(key);
      return next;
    }, { replace: true, preventScrollReset: true });
  }, [setSearchParams, defaults]);

  // Composición setFilters + reset como función con propiedad
  const setter = setFilters as UrlFilterSetter<T>;
  setter.reset = reset;

  return [filters, setter];
}
