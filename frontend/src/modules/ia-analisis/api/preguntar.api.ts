import client from '@/shared/api/client';

/** Lo que devuelve el servidor al preguntarle a los datos (#30). */
export interface Desglose {
  /** Qué consulta se hizo: `resumen_general`, `resumen_mensual`, `ventas_por_asesora`, `campana_que_rinde`. */
  consulta: string;
  /** Los parámetros DE VERDAD usados (no los que pidió el modelo): sirve para comprobarlo a mano. */
  parametros: Record<string, unknown>;
  datos: unknown;
}

export interface GastoIA {
  porcentaje: number;
  cerca: boolean;
  queda: number | null;
  tope: number;
  gastado: number | null;
}

export interface RespuestaIA {
  respuesta: string;
  /** El modelo contestó sin que ninguna consulta respaldara nada: no se enseña su texto. */
  sinDatos: boolean;
  /** Todas las cifras de la respuesta salen de los datos del desglose. */
  verificada: boolean;
  desglose: Desglose[];
  /** Cifras que NO se encuentran en los datos (pueden ser sumas o porcentajes calculados). */
  cifrasSinComprobar: string[];
  gasto?: GastoIA;
}

/** Códigos de fallo que el servidor devuelve y que la pantalla distingue. */
export type CodigoFallo = 'SIN_CLAVE' | 'TOPE' | 'IA_NO_RESPONDE' | 'SIN_RESPUESTA' | 'RATE_LIMITED';

export class FalloIA extends Error {
  codigo: CodigoFallo | string;
  constructor(mensaje: string, codigo: CodigoFallo | string) {
    super(mensaje);
    this.codigo = codigo;
  }
}

/**
 * Pregunta en lenguaje natural. El alcance (qué campus se miden) NO va en el
 * cuerpo: lo decide el servidor por la sesión; `projectId` e `issuerId` solo
 * sirven para acotar dentro de lo que la persona ya puede ver.
 */
export async function preguntar(
  pregunta: string,
  alcance: { projectId?: number | null; issuerId?: number | null } = {},
): Promise<RespuestaIA> {
  const params: Record<string, unknown> = {};
  if (alcance.projectId && alcance.projectId > 0) params.projectId = alcance.projectId;
  if (alcance.issuerId) params.issuerId = alcance.issuerId;

  try {
    const r = await client.post<RespuestaIA>('/ia-analisis/preguntar', { pregunta }, { params });
    if (!r.data) throw new FalloIA('La respuesta llegó vacía.', 'SIN_RESPUESTA');
    return r.data;
  } catch (e) {
    const err = e as Error & { status?: number; data?: { code?: string } };
    if (err instanceof FalloIA) throw err;
    throw new FalloIA(err.message || 'No se pudo preguntar.', err.data?.code || 'DESCONOCIDO');
  }
}
