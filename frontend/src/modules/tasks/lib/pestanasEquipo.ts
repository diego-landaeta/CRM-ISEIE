import { empresaCorta } from './campusPorEmpresa';

/*
 * PESTAÑAS POR EQUIPO en «Mi tablero» (Diego, 04/11/2026): quien lleva las
 * colaboraciones de los profesores está en el equipo de colaboradores y en el de
 * tutores, y tiene que ver los DOS tableros por separado, sin mezclarse. Una
 * pestaña por equipo suyo, cada una con solo las tareas de ese equipo.
 *
 * Quien está en un solo equipo (o en ninguno) no ve pestañas. Quien ve todo el
 * equipo («Ver todo») tiene además «Todos los equipos», para no perder la vista
 * de siempre.
 */

export interface EquipoPropio {
  team_id: number;
  team_name: string;
  team_tipo?: string | null;
  empresa?: string | null;
}

export interface Pestana {
  /** El valor del filtro de equipo: el id, o '' = todos. */
  value: string;
  label: string;
  tipo: string | null;
}

export const TODOS_LOS_EQUIPOS = 'Todos los equipos';

export function pestanasDeEquipos(misEquipos: ReadonlyArray<EquipoPropio>, { conTodos = false } = {}): Pestana[] {
  // Un equipo una vez, aunque llegue repetido.
  const unicos = [...new Map(misEquipos.map((e) => [e.team_id, e])).values()];
  if (unicos.length < 2) return [];
  const repetido = (e: EquipoPropio) => unicos.some((o) => o.team_id !== e.team_id && o.team_name === e.team_name);
  const pestanas = unicos.map((e) => ({
    value: String(e.team_id),
    label: repetido(e) ? `${e.team_name} · ${empresaCorta(e.empresa ?? null)}` : e.team_name,
    tipo: e.team_tipo ?? null,
  }));
  return conTodos ? [{ value: '', label: TODOS_LOS_EQUIPOS, tipo: null }, ...pestanas] : pestanas;
}

/** La pestaña que vale: la elegida si existe; si no, la primera. Sin pestañas, la elegida tal cual. */
export function pestanaValida(pestanas: ReadonlyArray<Pestana>, elegida: string): string {
  if (!pestanas.length || pestanas.some((p) => p.value === elegida)) return elegida;
  return pestanas[0].value;
}
