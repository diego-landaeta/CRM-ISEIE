import { useCallback, useEffect, useRef, useState } from 'react';
import { avanceMoodleApi, type AvanceMoodle } from '../api/avanceMoodle.api';

/**
 * El avance en Moodle de un alumno (#532), leído al abrir su ficha (el servidor guarda
 * unos minutos lo que dice cada campus). `actualizar()` lo vuelve a pedir al campus.
 * Si la petición falla, `error`; el resto de la ficha no depende de esto.
 */
export function useAvanceMoodle(leadId: number | string | null | undefined) {
  const [datos, setDatos] = useState<AvanceMoodle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Que la respuesta de otra ficha (al navegar rápido) no pise la de esta.
  const peticion = useRef(0);

  const cargar = useCallback(async (refrescar = false) => {
    if (!leadId) return;
    const mia = ++peticion.current;
    setCargando(true);
    setError(null);
    try {
      const r = await avanceMoodleApi.delAlumno(leadId, { refrescar });
      if (peticion.current !== mia) return;
      setDatos(r?.data || null);
    } catch (err) {
      if (peticion.current !== mia) return;
      setError((err as { data?: { error?: string }; message?: string })?.data?.error
        || (err as Error)?.message || 'No se ha podido leer el campus.');
    } finally {
      if (peticion.current === mia) setCargando(false);
    }
  }, [leadId]);

  useEffect(() => {
    setDatos(null);
    cargar(false);
  }, [cargar]);

  return { datos, cargando, error, actualizar: () => cargar(true) };
}
