import type { FichaDeIntegrante } from '../types';

/*
 * «Por integrante» del Historial de tareas (Diego, 11/11/2026: «que sea
 * individual por integrante también y cada uno lo tenga»). Los totales los da el
 * servidor; aquí solo se ordenan: primero quien mira («Yo»), aunque no tenga
 * ninguna, y luego el resto de más a menos tareas (y por nombre si empatan).
 */
export function ordenarFichas(fichas: FichaDeIntegrante[], yo: number, miNombre = 'Yo'): FichaDeIntegrante[] {
  const mia = fichas.find((f) => f.id === yo) ?? { id: yo, nombre: miNombre, total: 0 };
  const resto = fichas
    .filter((f) => f.id !== yo)
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
  return [mia, ...resto];
}

/** Pulsar una ficha filtra a esa persona; pulsar la que ya está elegida, quita el filtro. */
export function alternarPersona(actual: number | '', id: number): number | '' {
  return actual === id ? '' : id;
}
