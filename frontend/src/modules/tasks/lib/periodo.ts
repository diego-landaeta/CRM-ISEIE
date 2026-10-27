import type { Task } from '../types';
import { ZONA_OFICINA, diaEnOficina } from './taskUi';

/**
 * El periodo del tablero (Diego, 27/10/2026: «clasificarla en vistas por día,
 * semana y mes»). Todo en días de la oficina (AAAA-MM-DD en Madrid), igual que
 * el servidor (APP_TIMEZONE): un día es el mismo para todo el equipo.
 *
 * Una tarea entra en el periodo si se creó, se terminó o vence dentro, o si
 * sigue abierta y se creó antes de que acabe. Esta regla es la del servidor
 * (`findTasks`, tasks.model.js); aquí sirve para contar lo que se enseña.
 */
export type TipoPeriodo = 'todo' | 'dia' | 'semana' | 'mes';
export type Rango = { desde: string; hasta: string };

const aFecha = (dia: string) => new Date(`${dia}T12:00:00Z`);
const aDia = (f: Date) => f.toISOString().slice(0, 10);
function sumarDias(dia: string, n: number): string {
  const f = aFecha(dia);
  f.setUTCDate(f.getUTCDate() + n);
  return aDia(f);
}

/** El día de hoy en la oficina. */
export const hoyEnOficina = (ahora: Date = new Date()) => diaEnOficina(ahora);

/** El rango de un periodo que contiene `referencia` (la semana, de lunes a domingo). */
export function rangoDePeriodo(tipo: TipoPeriodo, referencia: string): Rango | null {
  if (tipo === 'todo') return null;
  if (tipo === 'dia') return { desde: referencia, hasta: referencia };
  if (tipo === 'semana') {
    const dow = (aFecha(referencia).getUTCDay() + 6) % 7; // lunes = 0
    const desde = sumarDias(referencia, -dow);
    return { desde, hasta: sumarDias(desde, 6) };
  }
  const [y, m] = referencia.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

/** El periodo anterior (-1) o el siguiente (+1): el día de referencia, movido. */
export function moverReferencia(tipo: TipoPeriodo, referencia: string, paso: 1 | -1): string {
  if (tipo === 'dia') return sumarDias(referencia, paso);
  if (tipo === 'semana') return sumarDias(referencia, 7 * paso);
  if (tipo === 'mes') {
    const [y, m] = referencia.split('-').map(Number);
    const f = new Date(Date.UTC(y, m - 1 + paso, 1));
    return aDia(f);
  }
  return referencia;
}

const fmt = (dia: string, opciones: Intl.DateTimeFormatOptions) =>
  aFecha(dia).toLocaleDateString('es-ES', { timeZone: 'UTC', ...opciones }).replace('.', '');
const diaCorto = (dia: string) => fmt(dia, { day: 'numeric', month: 'short' });

/** «Hoy, martes 27 oct», «Semana del 26 oct al 1 nov», «Octubre de 2026», «Todas las fechas». */
export function etiquetaDePeriodo(tipo: TipoPeriodo, rango: Rango | null, hoy: string = hoyEnOficina()): string {
  if (!rango) return 'Todas las fechas';
  if (tipo === 'dia') {
    const largo = fmt(rango.desde, { weekday: 'long', day: 'numeric', month: 'short' });
    if (rango.desde === hoy) return `Hoy, ${largo}`;
    if (rango.desde === sumarDias(hoy, -1)) return `Ayer, ${largo}`;
    if (rango.desde === sumarDias(hoy, 1)) return `Mañana, ${largo}`;
    return largo.charAt(0).toUpperCase() + largo.slice(1);
  }
  if (tipo === 'semana') return `Semana del ${diaCorto(rango.desde)} al ${diaCorto(rango.hasta)}`;
  const mes = fmt(rango.desde, { month: 'long', year: 'numeric' });
  return mes.charAt(0).toUpperCase() + mes.slice(1);
}

const dentro = (fecha: string | null | undefined, r: Rango) => {
  if (!fecha) return false;
  const d = diaEnOficina(fecha);
  return d >= r.desde && d <= r.hasta;
};

/** Si una tarea entra en el periodo (la misma regla que el servidor). */
export function entraEnPeriodo(
  t: Pick<Task, 'created_at' | 'completed_at' | 'due_date' | 'status'>,
  r: Rango | null
): boolean {
  if (!r) return true;
  if (dentro(t.created_at, r) || dentro(t.completed_at, r) || dentro(t.due_date, r)) return true;
  return t.status !== 'hecha' && diaEnOficina(t.created_at) <= r.hasta;
}

/** Lo que dice la línea de debajo de los filtros. */
export function resumenDelPeriodo(
  tasks: ReadonlyArray<Pick<Task, 'created_at' | 'completed_at' | 'due_date' | 'status'>>,
  r: Rango | null
): { total: number; creadas: number; terminadas: number; vencen: number } {
  const lista = tasks.filter((t) => entraEnPeriodo(t, r));
  if (!r) {
    return { total: lista.length, creadas: lista.length, terminadas: lista.filter((t) => t.status === 'hecha').length, vencen: 0 };
  }
  return {
    total: lista.length,
    creadas: lista.filter((t) => dentro(t.created_at, r)).length,
    terminadas: lista.filter((t) => t.status === 'hecha' && dentro(t.completed_at, r)).length,
    vencen: lista.filter((t) => t.status !== 'hecha' && dentro(t.due_date, r)).length,
  };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «Semana del 26 oct al 1 nov · 12 tareas: 5 creadas, 3 terminadas, 1 vence». */
export function textoDelPeriodo(tipo: TipoPeriodo, rango: Rango | null, tasks: Parameters<typeof resumenDelPeriodo>[0], hoy?: string): string {
  const r = resumenDelPeriodo(tasks, rango);
  const cabeza = `${etiquetaDePeriodo(tipo, rango, hoy)} · ${plural(r.total, 'tarea', 'tareas')}`;
  if (!rango) return r.terminadas ? `${cabeza}: ${plural(r.terminadas, 'terminada', 'terminadas')}` : cabeza;
  const partes = [plural(r.creadas, 'creada', 'creadas'), plural(r.terminadas, 'terminada', 'terminadas')];
  if (r.vencen) partes.push(plural(r.vencen, 'vence', 'vencen'));
  return `${cabeza}: ${partes.join(', ')}`;
}

/** «27 oct» (o «27 oct 2025» si no es de este año), en la oficina. */
export function fechaCorta(iso: string, ahora: Date = new Date()): string {
  const dia = diaEnOficina(iso);
  const mismoAno = dia.slice(0, 4) === diaEnOficina(ahora).slice(0, 4);
  return fmt(dia, mismoAno ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** «27/10/2026, 10:42», en la oficina. */
export function fechaYHora(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { timeZone: ZONA_OFICINA, dateStyle: 'short', timeStyle: 'short' });
}
