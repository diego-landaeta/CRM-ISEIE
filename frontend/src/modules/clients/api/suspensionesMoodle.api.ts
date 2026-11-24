import client from '@/shared/api/client';

// Las suspensiones y reactivaciones del alumno en Moodle (CRM#531): `GET /leads/:id/suspensiones-moodle`.
// Lo que avisa el plugin `local_crm` 1.13.0, con el motivo que dedujo el CRM al recibirlo.

export type MotivoSuspension =
  | 'cobro_fallido' | 'cuota_vencida' | 'pendiente_vencido' | 'sin_motivo' | 'reactivado' | 'pago';

export interface CambioDeEstado {
  id: number;
  projectId: number;
  campus?: string | null;
  ambito: 'cuenta' | 'curso';
  curso: { id: number; nombre: string | null } | null;
  suspendido: boolean;
  fecha: string;
  /** 'ws' servicio web (Make…), 'cli' un script, 'web' una persona desde Moodle. */
  via: 'ws' | 'cli' | 'web' | null;
  motivo: MotivoSuspension;
  motivoTexto: string | null;
}

export interface EstadoEnCampus {
  projectId: number;
  campus: string | null;
  estado: 'suspendido' | 'reactivado';
  desde: string;
  motivo: MotivoSuspension;
  motivoTexto: string | null;
  /** Suspendida la cuenta entera. */
  cuenta: boolean;
  /** Cursos con la matrícula suspendida. */
  cursos: { id: number; nombre: string | null }[];
}

export interface SuspensionesMoodle {
  /** false = apagado en este servidor (SUSPENSIONES_MOODLE_EN_PRODUCCION): no se enseña nada. */
  disponible: boolean;
  suspendido: boolean;
  campus: EstadoEnCampus[];
  historial: CambioDeEstado[];
}

export const suspensionesMoodleApi = {
  delAlumno: (leadId: number | string) =>
    client.get(`/leads/${leadId}/suspensiones-moodle`) as Promise<{ success: boolean; data: SuspensionesMoodle }>,
};
