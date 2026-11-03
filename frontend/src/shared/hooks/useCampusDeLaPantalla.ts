import { useEffect, useMemo, useState } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useProyectosDelAmbito } from '@/shared/hooks/useAmbito';

type Campus = { id: number; nombre: string; sociedad_emisora_id?: number | null; es_prueba?: boolean };

/**
 * El campus de una pantalla que es de UN campus (#218, tanda 3): buscar
 * duplicados, Meta Ads, el chat IA… Sus datos no se suman entre campus —los
 * duplicados se buscan dentro de cada uno, una cuenta de anuncios es de uno—,
 * así que con una empresa o «Todos los proyectos» arriba no se tapia la
 * pantalla: se elige el campus AQUÍ, entre los del ámbito, sin tocar la
 * cabecera.
 *
 *   · Con un campus en la cabecera, ese (`fijo`).
 *   · Con una empresa o «Todos», el que se elija; si el ámbito tiene uno solo,
 *     ya viene elegido.
 */
export function useCampusDeLaPantalla() {
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string } | null;
    activeIssuerId?: number | null;
  };
  const opciones = useProyectosDelAmbito<Campus>();
  const deLaCabecera = activeProject?.id && activeProject.id > 0 ? activeProject.id : null;
  const [elegido, setElegido] = useState<number | null>(null);

  // Al cambiar la cabecera, lo elegido aquí ya no vale.
  useEffect(() => { setElegido(null); }, [deLaCabecera, activeIssuerId]);

  const id = deLaCabecera ?? elegido ?? (opciones.length === 1 ? opciones[0].id : null);
  const nombre = useMemo(() => {
    if (deLaCabecera) return activeProject?.nombre || '';
    return opciones.find((c) => c.id === id)?.nombre || '';
  }, [deLaCabecera, activeProject?.nombre, opciones, id]);

  return {
    /** El campus de la pantalla, o null si falta elegirlo. */
    id,
    nombre,
    /** Viene de la cabecera: no hay nada que elegir aquí. */
    fijo: Boolean(deLaCabecera),
    opciones,
    elegir: setElegido,
  };
}
