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
 */
export function useIdsDelAmbito(): number[] {
  const { projects, activeIssuerId } = useProjectContext() as {
    projects: Array<{ id: number; sociedad_emisora_id?: number | null }>;
    activeIssuerId: number | null;
  };
  return useMemo(() => {
    const todos = projects || [];
    const suyos = activeIssuerId
      ? todos.filter((p) => Number(p.sociedad_emisora_id) === Number(activeIssuerId))
      : todos;
    return suyos.map((p) => p.id);
  }, [projects, activeIssuerId]);
}

/** Los proyectos enteros del ámbito, no solo sus identificadores. */
export function useProyectosDelAmbito<T extends { id: number; sociedad_emisora_id?: number | null }>(): T[] {
  const { projects, activeIssuerId } = useProjectContext() as {
    projects: T[];
    activeIssuerId: number | null;
  };
  return useMemo(() => {
    const todos = projects || [];
    return activeIssuerId
      ? todos.filter((p) => Number(p.sociedad_emisora_id) === Number(activeIssuerId))
      : todos;
  }, [projects, activeIssuerId]);
}
