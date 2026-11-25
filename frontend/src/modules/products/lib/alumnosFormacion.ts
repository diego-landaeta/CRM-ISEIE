import { soloFecha } from '@/shared/lib/fechas';
import type { AlumnoFormacion, EstadoPago, MotivoBajaAlumno, ResumenAlumnos } from '../api/alumnos.api';

/**
 * Formaciones · alumnos activos (CRM-ISEIE#767, gemela de CRM#1113): textos y orden de la pantalla.
 * Las reglas (quién es activo, hasta cuándo, cómo va de pagos) las decide el
 * servidor (`formacion-alumnos.reglas.js`); aquí solo se enseñan.
 */

/** La ficha de la venta (en el 360, `/finanzas/ventas/:id`). */
export const rutaDeVenta = (id: number) => `/ventas/${id}`;

/** «24 nov 26». */
export function fechaCorta(iso?: string | null): string {
  const d = soloFecha(iso);
  return d ? d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
}

export const TEXTO_PAGO: Record<EstadoPago, string> = {
  al_dia: 'Al día',
  pendiente: 'Cuotas pendientes',
  impago: 'Impago',
};

export const TONO_PAGO: Record<EstadoPago, string> = {
  al_dia: 'bg-success-soft text-success-soft-foreground',
  pendiente: 'bg-warning-soft text-warning-soft-foreground',
  impago: 'bg-destructive-soft text-destructive-soft-foreground',
};

export const TEXTO_MOTIVO_BAJA: Record<MotivoBajaAlumno, string> = {
  desistimiento: 'Desistimiento en plazo',
  voluntaria: 'Baja voluntaria',
  impago: 'Impago',
  otro: 'Otro',
};

/** Lo que se lee en la columna «Estado» de un alumno: «Baja (motivo)» si está de baja. */
export function textoEstado(a: Pick<AlumnoFormacion, 'estado' | 'motivo_fuera'> & { motivo_baja?: MotivoBajaAlumno | null }): string {
  if (a.estado === 'activo') return 'Activo';
  if (a.estado === 'terminado') return 'Terminado';
  if (a.estado === 'baja') return `Baja (${TEXTO_MOTIVO_BAJA[a.motivo_baja || 'otro'] || 'Otro'})`;
  return a.motivo_fuera === 'devuelta' ? 'Devuelta' : 'Anulada';
}

export type FiltroAlumnos = 'activos' | 'impago' | 'pendiente' | 'terminados' | 'baja' | 'todos';

export function filtrarAlumnos(alumnos: AlumnoFormacion[], filtro: FiltroAlumnos): AlumnoFormacion[] {
  switch (filtro) {
    case 'activos': return alumnos.filter((a) => a.estado === 'activo');
    case 'impago': return alumnos.filter((a) => a.estado === 'activo' && a.pago === 'impago');
    case 'pendiente': return alumnos.filter((a) => a.estado === 'activo' && a.pago === 'pendiente');
    case 'terminados': return alumnos.filter((a) => a.estado === 'terminado');
    case 'baja': return alumnos.filter((a) => a.estado === 'baja');
    default: return alumnos;
  }
}

export type OrdenFormaciones = 'nombre' | 'activos' | 'impago';

/** La lista de formaciones ordenada por nombre o por sus alumnos (de más a menos; a igualdad, por nombre). */
export function ordenarFormaciones<T extends { id: number; nombre: string }>(
  filas: T[], orden: OrdenFormaciones, cifras: Record<string, ResumenAlumnos> | null,
): T[] {
  const por = (f: T) => {
    const c = cifras?.[String(f.id)];
    if (orden === 'activos') return c?.activos ?? 0;
    if (orden === 'impago') return c?.impago ?? 0;
    return 0;
  };
  return [...filas].sort((a, b) => (por(b) - por(a)) || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Los totales del campus (la suma de sus formaciones): un alumno con dos formaciones cuenta en las dos. */
export function totalesDelCampus(cifras: Record<string, ResumenAlumnos> | null): { activos: number; impago: number; baja: number } {
  let activos = 0;
  let impago = 0;
  let baja = 0;
  for (const c of Object.values(cifras || {})) { activos += c.activos; impago += c.impago; baja += c.baja ?? 0; }
  return { activos, impago, baja };
}
