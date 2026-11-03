import { useMemo } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';

/**
 * Qué proyectos entran cuando está puesto «Todos».
 *
 * Con una EMPRESA elegida, «todos» son SUS campus y ninguno más.
 *
 * Cada pantalla se lo montaba por su cuenta con `projects.map(p => p.id)`, que
 * es la lista entera del usuario y se salta la sociedad. Con CEDIA puesta
 * —siete campus— se colaban los prospectos de ACADEMIA IA, que es de Lateral
 * Thinking. Diego: «academia IA no es de CEDIA, es de Lateral Thinking».
 *
 * Es el mismo problema que ya resolvimos en el backend con `ambito.js`, y la
 * misma solución: la regla vive UNA vez. Si cada pantalla la repite, acaban
 * dando cifras distintas para la misma pregunta.
 *
 * Y con «Todos» (sin empresa) no entran los campus de pruebas: la regla de la
 * migración 148 y de `SIN_PRUEBAS` en el servidor, «un proyecto de pruebas solo
 * se ve si lo eliges». Con su empresa elegida, sí: es SU empresa (#346).
 */
type Campus = { id: number; sociedad_emisora_id?: number | null; es_prueba?: boolean };

export function delAmbito<T extends Campus>(projects: T[] | null | undefined, activeIssuerId: number | null): T[] {
  const todos = (projects || []).filter((p) => p?.id > 0);
  return activeIssuerId
    ? todos.filter((p) => Number(p.sociedad_emisora_id) === Number(activeIssuerId))
    : todos.filter((p) => !p.es_prueba);
}

/**
 * Lo elegido en un filtro de campus, sin lo que no es del ámbito (#346). El
 * filtro vive en la dirección y sobrevive a cambiar la empresa de arriba: sin
 * esto, con ICTESS elegido y CEDIA arriba se seguían viendo los de ICTESS, y el
 * desplegable —que ya solo lista CEDIA— no lo enseñaba en ninguna parte.
 */
export function soloDelAmbito(ids: number[], idsDelAmbito: number[]): number[] {
  const dentro = new Set(idsDelAmbito);
  return ids.filter((id) => dentro.has(id));
}

export function useIdsDelAmbito(): number[] {
  const { projects, activeIssuerId } = useProjectContext() as {
    projects: Campus[];
    activeIssuerId: number | null;
  };
  return useMemo(() => delAmbito(projects, activeIssuerId).map((p) => p.id), [projects, activeIssuerId]);
}

/** Los proyectos enteros del ámbito, no solo sus identificadores. */
export function useProyectosDelAmbito<T extends Campus>(): T[] {
  const { projects, activeIssuerId } = useProjectContext() as {
    projects: T[];
    activeIssuerId: number | null;
  };
  return useMemo(() => delAmbito(projects, activeIssuerId), [projects, activeIssuerId]);
}
