import { useCallback, useEffect, useRef, useState } from 'react';
import { suspensionesMoodleApi, type SuspensionesMoodle } from '../api/suspensionesMoodle.api';

/**
 * Las suspensiones del alumno en Moodle (CRM#531), al abrir su ficha. Solo lee el CRM (no
 * llama a ningún campus), así que es rápido y no hay «Actualizar». Si falla, `error`; el
 * resto de la ficha no depende de esto.
 */
export function useSuspensionesMoodle(leadId: number | string | null | undefined) {
  const [datos, setDatos] = useState<SuspensionesMoodle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const peticion = useRef(0);

  const cargar = useCallback(async () => {
    if (!leadId) return;
    const mia = ++peticion.current;
    setCargando(true);
    setError(null);
    try {
      const r = await suspensionesMoodleApi.delAlumno(leadId);
      if (peticion.current !== mia) return;
      setDatos(r?.data || null);
    } catch (err) {
      if (peticion.current !== mia) return;
      setError((err as { data?: { error?: string }; message?: string })?.data?.error
        || (err as Error)?.message || 'No se han podido leer las suspensiones.');
    } finally {
      if (peticion.current === mia) setCargando(false);
    }
  }, [leadId]);

  useEffect(() => {
    setDatos(null);
    cargar();
  }, [cargar]);

  return { datos, cargando, error };
}
