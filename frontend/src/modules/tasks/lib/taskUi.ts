import type { Task, TaskPriority, TaskStatus, TagColor } from '../types';

/** Las cuatro columnas del sistema por defecto, en orden. */
export const DEFAULT_COLUMNS: ReadonlyArray<{ key: TaskStatus; label: string; dot: string; head: string }> = [
  { key: 'por_hacer', label: 'Por hacer', dot: 'bg-slate-400', head: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200' },
  { key: 'en_curso', label: 'En curso', dot: 'bg-blue-500', head: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' },
  { key: 'en_revision', label: 'En revisión', dot: 'bg-amber-500', head: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  { key: 'hecha', label: 'Hecha', dot: 'bg-emerald-500', head: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
];

export const STATUS_LABEL: Record<string, string> = {
  por_hacer: 'Por hacer',
  en_curso: 'En curso',
  en_revision: 'En revisión',
  hecha: 'Hecha',
};

export const PRIORITY: Record<TaskPriority, { label: string; border: string; chip: string }> = {
  alta: {
    label: 'Alta',
    border: 'border-l-rose-500 dark:border-l-rose-600',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50',
  },
  media: {
    label: 'Media',
    border: 'border-l-amber-500 dark:border-l-amber-600',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50',
  },
  baja: {
    label: 'Baja',
    border: 'border-l-slate-400 dark:border-l-slate-600',
    chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800/80 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
  },
};

export const TAG_COLORS: Record<TagColor, { label: string; chip: string }> = {
  sky: { label: 'Azul', chip: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border border-sky-200 dark:border-sky-800' },
  rose: { label: 'Rojo', chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800' },
  amber: { label: 'Ámbar', chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800' },
  emerald: { label: 'Verde', chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' },
  violet: { label: 'Violeta', chip: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300 border border-violet-200 dark:border-violet-800' },
  slate: { label: 'Gris', chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700' },
};

/**
 * Los colores del tablero (columnas, áreas y proyectos propios). Son los mismos
 * que acepta el servidor (COLORES_TABLERO en tasks.validation.js): un color que
 * no esté aquí no se puede guardar. Como la paleta de avatares, es identidad y
 * no significado, y por eso lleva escrita su variante oscura.
 */
export const BOARD_COLORS: Record<string, { label: string; dot: string; head: string; chip: string }> = {
  gray: {
    label: 'Gris', dot: 'bg-slate-400',
    head: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200',
    chip: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700',
  },
  blue: {
    label: 'Azul', dot: 'bg-blue-500',
    head: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300',
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300 border-sky-200 dark:border-sky-800',
  },
  yellow: {
    label: 'Ámbar', dot: 'bg-amber-500',
    head: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  green: {
    label: 'Verde', dot: 'bg-emerald-500',
    head: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  purple: {
    label: 'Violeta', dot: 'bg-purple-500',
    head: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
    chip: 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  },
  rose: {
    label: 'Rojo', dot: 'bg-rose-500',
    head: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  },
};

export const boardColor = (color: string | null | undefined) => BOARD_COLORS[color || 'gray'] || BOARD_COLORS.gray;

export const tagChip = (color: string): string =>
  (TAG_COLORS[color as TagColor] || TAG_COLORS.sky).chip;

/**
 * La zona de la oficina, la misma que usa el servidor (APP_TIMEZONE) para el
 * comentario automático, el correo de cada mañana y los filtros por fecha.
 *
 * Una fecha límite es un DÍA, no una hora: elegir el 14/10 tiene que ser el
 * 14/10 para todo el equipo. Con la hora del navegador, desde Caracas el 14/10
 * a las 23:59 ya era el 15/10 en Madrid, y el comentario decía «al 15/10»
 * mientras la tarjeta enseñaba 14/10 (QA del 09/10).
 */
export const ZONA_OFICINA = 'Europe/Madrid';

/** El día (AAAA-MM-DD) que es un instante en la oficina. */
export function diaEnOficina(fecha: Date | string): string {
  // `en-CA` da justo AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_OFICINA, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(fecha));
}

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

/** «Vence hoy», «Vencida · 3 oct», «Mañana», «31 oct»… con su tono. */
export function dueInfo(
  task: Pick<Task, 'due_date' | 'status'>,
  ahora: Date = new Date()
): { label: string; classes: string } | null {
  if (!task.due_date) return null;
  const diff = diasEntre(diaEnOficina(ahora), diaEnOficina(task.due_date));
  const fecha = new Date(task.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: ZONA_OFICINA });
  if (task.status === 'hecha') return { label: fecha, classes: 'bg-muted text-muted-foreground' };
  if (diff < 0) return { label: `Vencida · ${fecha}`, classes: 'bg-destructive-soft text-destructive-soft-foreground' };
  if (diff === 0) return { label: 'Vence hoy', classes: 'bg-warning-soft text-warning-soft-foreground' };
  if (diff === 1) return { label: 'Mañana', classes: 'bg-info-soft text-info-soft-foreground' };
  return { label: fecha, classes: 'bg-muted text-muted-foreground' };
}

/** La fecha guardada (ISO) como la quiere un `<input type="date">`: su día en la oficina. */
export function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return diaEnOficina(iso);
}

/**
 * Del `<input type="date">` a ISO: vence al final de ese día EN LA OFICINA
 * (23:59 de Madrid), esté donde esté quien la pone.
 */
export function fromDateInput(value: string): string | null {
  if (!value) return null;
  // Las 23:59 «de pared» como si fueran UTC, y se corrige por lo que Madrid
  // se aparta de UTC ese día (1 o 2 horas según el horario de verano). A las
  // 23:59 nunca hay cambio de hora, así que basta una pasada.
  const comoUtc = Date.parse(`${value}T23:59:00Z`);
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_OFICINA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(comoUtc)).map((p) => [p.type, p.value]));
  const pared = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute);
  return new Date(comoUtc - (pared - comoUtc)).toISOString();
}

/**
 * Entre qué dos tarjetas cae una que se suelta en la posición `index` de una
 * columna ya pintada. Devuelve `null` si se suelta donde ya estaba.
 */
export function neighboursAt(
  column: ReadonlyArray<Pick<Task, 'id'>>,
  index: number,
  draggedId: number
): { prev_id: number | null; next_id: number | null } | null {
  const before = column[index - 1];
  const after = column[index];
  if (before?.id === draggedId || after?.id === draggedId) return null;
  const sin = column.filter((t) => t.id !== draggedId);
  const at = column.slice(0, index).filter((t) => t.id !== draggedId).length;
  return { prev_id: sin[at - 1]?.id ?? null, next_id: sin[at]?.id ?? null };
}

/**
 * Quién edita una tarea (Diego, 08/10 y WhatsApp 09/10): el admin («Editar» +
 * «Ver todo») y la persona asignada. Los demás la ven y la comentan. Sin nadie
 * asignado, también quien la creó. Es la misma regla que aplica el servidor;
 * aquí solo evita ofrecer lo que daría 403.
 */
/**
 * Qué tareas enseña el único tablero (Diego, 27/10/2026: «un solo tablero, y ya
 * con filtros»): «Mis tareas» (lo que llevo, superviso o creé), «Mi equipo»
 * (eso y lo de mis equipos) o «Todo» (lo que mi permiso me deje ver). El
 * servidor manda: «Todo» nunca abre más de lo permitido.
 */
export type VerTablero = 'mias' | 'equipo' | 'todo';
export const OPCIONES_VER: ReadonlyArray<{ value: VerTablero; label: string }> = [
  { value: 'mias', label: 'Mis tareas' },
  { value: 'equipo', label: 'Mi equipo' },
  { value: 'todo', label: 'Todo' },
];

/** Se entra siempre en «Mis tareas», sea quien sea (Diego, 26/10/2026). */
export const VISTA_INICIAL: VerTablero = 'mias';

/** Lo que pide cada «Ver» al servidor. */
export function filtroDeVista(ver: VerTablero): { ver: VerTablero } {
  return { ver };
}

export function puedeEditarTarea(
  task: { assigned_to: number | null; created_by?: number | null } | null | undefined,
  yo: number,
  permisos: { edit: boolean; viewAll: boolean },
): boolean {
  if (!task) return false;
  return permisos.edit && ((task.assigned_to ?? task.created_by ?? null) === yo || permisos.viewAll);
}

/**
 * Lo que manda la ficha al guardar una tarea que ya existe (QA de Diego, 08/10,
 * y WhatsApp 09/10):
 *   · el estado NO va en el PATCH (el servidor lo descarta): si cambió, se
 *     mueve aparte con `moveTask`;
 *   · solo los campos que de verdad cambian: así el admin reasigna sin que
 *     parezca que edita, y no quedan comentarios de cambios que no hubo;
 *   · `assigned_to` solo con «Asignar».
 * La fecha se compara por su día en la oficina, que es lo que enseña la ficha.
 */
export function armarCambiosDeTarea<B extends Record<string, unknown>>({
  base, actual, estadoAntes, estadoNuevo, canAssign, assignedTo,
}: {
  base: B;
  actual: Partial<Record<keyof B | 'assigned_to', unknown>>;
  estadoAntes: TaskStatus;
  estadoNuevo: TaskStatus;
  canAssign: boolean;
  assignedTo: number | null;
}): { mover: TaskStatus | null; actualizar: Partial<B> & { assigned_to?: number | null } } {
  const igual = (k: string, a: unknown, b: unknown) => {
    if (k === 'due_date') return toDateInput((a as string) || null) === toDateInput((b as string) || null);
    if (a == null || a === '') return b == null || b === '';
    return b != null && String(a) === String(b);
  };
  const actualizar: Partial<B> & { assigned_to?: number | null } = {};
  for (const [k, v] of Object.entries(base)) {
    if (!igual(k, (actual as Record<string, unknown>)[k], v)) (actualizar as Record<string, unknown>)[k] = v;
  }
  const responsable = assignedTo || null;
  if (canAssign && !igual('assigned_to', actual.assigned_to, responsable)) actualizar.assigned_to = responsable;
  return { mover: estadoNuevo !== estadoAntes ? estadoNuevo : null, actualizar };
}
