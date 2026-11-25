import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

/*
  La baja del alumno en la venta (sobre CRM#1113 / CRM-ISEIE#767).

  Fecha, motivo y nota; se puede deshacer y queda en su historial. No anula
  facturas ni toca cobros, cuotas ni Moodle: solo avisa de lo que queda por
  cobrar. Verla, quien ve la venta; darla o deshacerla, `conversions.baja_alumno`.
*/

export type MotivoBaja = 'desistimiento' | 'voluntaria' | 'impago' | 'otro';

export interface BajaActual {
  fecha: string;
  motivo: MotivoBaja;
  motivo_texto: string;
  nota: string | null;
  por: string | null;
  at: string | null;
}

export interface EntradaHistorialBaja {
  id: number;
  accion: 'baja' | 'cambio' | 'deshecha';
  fecha_baja: string | null;
  motivo: MotivoBaja | null;
  motivo_texto: string | null;
  nota: string | null;
  usuario: string | null;
  at: string;
}

export interface BajaDeLaVenta {
  /** false = falta la migración en este CRM: no se enseña. */
  disponible: boolean;
  baja: BajaActual | null;
  historial: EntradaHistorialBaja[];
  avisos: {
    cuotas_pendientes: number;
    importe_cuotas_pendientes: number;
    pendiente: number;
    cobro_automatico: boolean;
    suscripcion_activa: boolean;
  };
  motivos: Array<{ clave: MotivoBaja; texto: string }>;
}

export const bajaAlumnoApi = {
  leer: (conversionId: number) =>
    client.get(`/conversions/${conversionId}/baja`) as Promise<ApiResponse<BajaDeLaVenta>>,
  dar: (conversionId: number, datos: { fecha: string; motivo: MotivoBaja; nota: string | null }) =>
    client.put(`/conversions/${conversionId}/baja`, datos) as Promise<ApiResponse<BajaDeLaVenta>>,
  deshacer: (conversionId: number, nota: string | null = null) =>
    client.delete(`/conversions/${conversionId}/baja`, { data: { nota } }) as Promise<ApiResponse<BajaDeLaVenta>>,
};
