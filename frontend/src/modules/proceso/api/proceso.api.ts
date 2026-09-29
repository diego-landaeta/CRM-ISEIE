import client, { type ApiResponse } from '@/shared/api/client';
import type { Canal } from '../lib/canales';

/**
 * Los pasos del proceso comercial.
 *
 * El servidor ya existe y está desplegado; aquí solo está la cara. El contrato
 * es el del issue #115 y no se inventa nada por encima de él.
 */

/**
 * De que ambito se esta hablando: un campus, o una empresa entera con todos
 * los suyos. Se manda igual en leer y en escribir, porque un cambio en el
 * proceso de CEDIA se aplica a sus siete campus.
 */
export type Ambito = { projectId?: number | null; issuerId?: number | null };

/** La empresa manda sobre el campus, igual que en el resto del CRM. */
function comoConsulta(ambito: Ambito): string {
  if (ambito.issuerId) return `issuerId=${ambito.issuerId}`;
  return `projectId=${ambito.projectId}`;
}

export interface Paso {
  id: number;
  project_id: number;
  /** En cuantos campus de la empresa existe este paso. Solo llega con empresa. */
  en_campus?: number;
  /** El nombre con el que el código encuentra el paso. NO se edita. */
  clave: string;
  nombre: string;
  orden: number;
  /** Solo para lo que no se cuenta en días, como «Final de mes». Con ventana
   *  de días la frase se dice sola y esto va vacío. */
  cuando: string | null;
  /** Días desde que entró el prospecto. Null en el de seguimiento. */
  dia_desde: number | null;
  dia_hasta: number | null;
  canales: Canal[];
  /** El de fin de mes: es toda la base, no la cola del día. */
  es_seguimiento: boolean;
  nota: string | null;
  activo: boolean;
}

export type PasoNuevo = {
  clave: string;
  nombre: string;
  orden?: number;
  cuando?: string | null;
  dia_desde?: number | null;
  dia_hasta?: number | null;
  canales?: Canal[];
  es_seguimiento?: boolean;
  nota?: string | null;
};

export type PasoCambios = Partial<Omit<PasoNuevo, 'clave'>> & { activo?: boolean };

export const procesoApi = {
  listar: (ambito: Ambito, incluirInactivos = false): Promise<ApiResponse<Paso[]>> =>
    client.get(
      `/proceso/pasos?${comoConsulta(ambito)}${incluirInactivos ? '&includeInactive=true' : ''}`,
    ),

  crear: (datos: PasoNuevo & Ambito): Promise<ApiResponse<Paso>> =>
    client.post('/proceso/pasos', datos),

  /** La lista ENTERA de ids, en su nuevo orden. No un movimiento suelto. */
  reordenar: (ids: number[], ambito: Ambito): Promise<ApiResponse<Paso[]>> =>
    client.patch(`/proceso/pasos/orden?${comoConsulta(ambito)}`, { ids }),

  editar: (id: number, cambios: PasoCambios, ambito: Ambito): Promise<ApiResponse<Paso>> =>
    client.patch(`/proceso/pasos/${id}?${comoConsulta(ambito)}`, cambios),

  /** Desactiva. No borra: el paso sigue existiendo y vuelve con el interruptor. */
  desactivar: (id: number, ambito: Ambito): Promise<ApiResponse<unknown>> =>
    client.delete(`/proceso/pasos/${id}?${comoConsulta(ambito)}`),
};

/** Qué se estaba intentando cuando el servidor dijo que no. */
export type Operacion = 'crear' | 'editar' | 'reordenar' | 'activar';

/**
 * Lo que hay que enseñar cuando el servidor dice que no.
 *
 * Con el porqué en cada uno: un «error 409» a secas obliga a adivinar, y quien
 * está delante no sabe qué es un 409.
 *
 * EL 400 SIGNIFICA DOS COSAS DISTINTAS, y por eso hace falta saber qué se
 * estaba haciendo. Guardando un paso es que el día final va antes que el
 * inicial; reordenando es que la lista trae un paso que no es de este proyecto
 * —lo dejó escrito Diego al contar cómo lo probó contra la base—. Enseñar lo
 * de los días al fallar un reordenamiento no dice nada de lo que ha pasado.
 */
export function mensajeDeError(
  estado: number | undefined,
  porDefecto: string,
  operacion: Operacion = 'editar',
): string {
  if (estado === 409) return 'Ya hay un paso con esa clave en este proyecto. Elige otra.';
  if (estado === 400) {
    return operacion === 'reordenar'
      ? 'La lista incluye un paso que no es de este proyecto. Vuelve a cargar la pantalla.'
      : 'El día final no puede ser anterior al inicial.';
  }
  if (estado === 404) return 'Ese paso no es de este proyecto.';
  if (estado === 403) return 'Esto solo lo puede cambiar un administrador.';
  return porDefecto;
}
