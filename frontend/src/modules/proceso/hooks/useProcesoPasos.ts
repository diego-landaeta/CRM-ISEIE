import { useCallback, useEffect, useState } from 'react';
import { procesoApi, type Paso, type Ambito } from '../api/proceso.api';

/**
 * Los pasos del proyecto activo.
 *
 * Guarda la lista en estado para poder reordenarla al soltar sin esperar al
 * servidor: arrastrar y que la fila vuelva a su sitio medio segundo se siente
 * roto. Si el servidor dice que no, se vuelve a lo que había.
 */
export default function useProcesoPasos(
  ambito: Ambito,
  incluirInactivos: boolean,
) {
  // Solo los dos numeros, para que el efecto no se vuelva a lanzar por recibir
  // un objeto nuevo en cada pintada.
  const projectId = ambito.projectId ?? null;
  const issuerId = ambito.issuerId ?? null;
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!projectId && !issuerId) { setPasos([]); setCargando(false); return; }
    setCargando(true);
    setError(null);
    try {
      const res = await procesoApi.listar({ projectId, issuerId }, incluirInactivos);
      setPasos(res.success ? (res.data || []) : []);
      if (!res.success) setError('No se han podido cargar los pasos.');
    } catch (e) {
      const err = e as { message?: string };
      setPasos([]);
      setError(err?.message || 'No se han podido cargar los pasos.');
    } finally {
      setCargando(false);
    }
  }, [projectId, issuerId, incluirInactivos]);

  useEffect(() => { recargar(); }, [recargar]);

  return { pasos, setPasos, cargando, error, recargar };
}
