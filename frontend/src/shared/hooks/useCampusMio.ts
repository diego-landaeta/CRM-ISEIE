import { useCallback } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';

/**
 * Si un campus es de quien mira (CRM#859).
 *
 * El servidor contesta `403 PROJECT_FORBIDDEN` a lo que se pide de un campus que
 * no es de la persona (`projectAccess`: sus `user_projects`; super admin y
 * soporte, todos). En el navegador, esos campus son los de `projects`, que
 * `/auth/me` calcula igual. Pasaba con el catálogo de productos del campus de un
 * prospecto: una gestora puede llevar un prospecto de un campus que no tiene
 * asignado, abría su ficha y salía un 403 por cada catálogo.
 *
 * Mientras no hay lista (todavía cargando), nada es suyo: se espera.
 */
export function esCampusMio(projects: Array<{ id: number }> | null | undefined, id: number | null | undefined): boolean {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || !Array.isArray(projects)) return false;
  return projects.some((p) => Number(p.id) === n);
}

export function useEsCampusMio(): (id: number | null | undefined) => boolean {
  const { projects } = useProjectContext() as { projects?: Array<{ id: number }> | null };
  return useCallback((id) => esCampusMio(projects, id), [projects]);
}
