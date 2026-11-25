import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

/**
 * Formaciones · alumnos activos (CRM-ISEIE#767, gemela de CRM#1113): los alumnos de cada
 * formación, hasta cuándo tienen acceso y cómo van de pagos. Con el alcance de
 * Ventas: una gestora solo recibe los suyos (`solo_lo_suyo`).
 */

export type EstadoAlumno = 'activo' | 'terminado' | 'fuera';
export type EstadoPago = 'al_dia' | 'pendiente' | 'impago';
export type OrigenFin = 'fin_formacion' | 'duracion' | 'regla_campus' | 'regla_de_serie';

export interface ReglaDeAcceso {
  curso: number;
  diplomado: number;
  master: number;
  /** false = la de serie (curso 3, diplomado 6, máster 12 meses). */
  configurada: boolean;
}

export interface ResumenAlumnos {
  activos: number;
  terminados: number;
  /** Activos + terminados (sin los de ventas anuladas o devueltas). */
  total: number;
  /** Ventas anuladas o devueltas: no cuentan. */
  fuera: number;
  /** De los activos. */
  al_dia: number;
  pendiente: number;
  impago: number;
}

export interface AlumnoFormacion {
  lead_id: number | null;
  nombre: string | null;
  email: string | null;
  gestora: string | null;
  /** La venta que manda (la de acceso más largo): a la que lleva el enlace. */
  venta_id: number;
  ventas: number[];
  fecha_venta: string | null;
  inicio: string | null;
  fin_acceso: string | null;
  origen_fin: OrigenFin | null;
  detalle_fin: string;
  estado: EstadoAlumno;
  motivo_fuera: 'anulada' | 'devuelta' | null;
  pago: EstadoPago | null;
}

export interface AlumnosDeFormacion {
  hoy: string;
  regla: ReglaDeAcceso;
  solo_lo_suyo: boolean;
  resumen: ResumenAlumnos;
  alumnos: AlumnoFormacion[];
}

export interface ResumenDelCampus {
  hoy: string;
  regla: ReglaDeAcceso;
  solo_lo_suyo: boolean;
  /** Solo las formaciones con algún alumno. */
  por_producto: Record<string, ResumenAlumnos>;
}

export const alumnosApi = {
  deFormacion: (id: number, projectId: number) =>
    client.get(`/products/${id}/formacion/alumnos?projectId=${projectId}`) as Promise<ApiResponse<AlumnosDeFormacion>>,
  delCampus: (projectId: number) =>
    client.get(`/products/formaciones/alumnos?projectId=${projectId}`) as Promise<ApiResponse<ResumenDelCampus>>,
  /** Meses por tipo; null = la de serie. */
  guardarRegla: (projectId: number, regla: { curso: number | null; diplomado: number | null; master: number | null }) =>
    client.put('/products/formaciones/acceso', { ...regla, projectId }) as Promise<ApiResponse<ReglaDeAcceso>>,
};
