import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';

// Las incidencias (#253), contra `/api/incidencias`.
//
// La forma es la que devuelve el servidor (`incidencias.model.js`). El recorte
// de quién ve qué lo pone él: aquí no se filtra nada por rol.

export type TipoIncidencia = 'capa8' | 'fallo_crm' | 'dato_mal' | 'externo';
export type Gravedad = 'low' | 'medium' | 'high' | 'critical';
export type EstadoIncidencia = 'open' | 'in_review' | 'resolved' | 'closed';
export type EntidadTipo = 'lead' | 'venta' | 'factura' | 'usuario' | 'otro';

export interface AdjuntoIncidencia {
  id: number;
  name: string;
  mime: string | null;
  size: number | null;
}

export interface Incidencia {
  id: number;
  ocurrioAt: string;
  crm: 'multicrm' | 'iseie';
  projectId: number | null;
  projectName: string | null;
  sociedadId: number | null;
  sociedadName: string | null;
  tipos: TipoIncidencia[];
  causadaPor: number | null;
  causadaPorNombre: string | null;
  detectadaPor: number | null;
  detectadaPorNombre: string | null;
  entidadTipo: EntidadTipo | null;
  entidadId: number | null;
  /** La venta de la factura de «sobre qué», si es de los campus de quien mira. */
  entidadVentaId?: number | null;
  /** El nombre del usuario de «sobre qué», si es de los campus de quien mira. */
  entidadNombre?: string | null;
  quePaso: string;
  impacto: string;
  comoSeArreglo: string;
  arregladaPor: number | null;
  arregladaPorNombre: string | null;
  arregladaAt: string | null;
  gravedad: Gravedad;
  estado: EstadoIncidencia;
  creadaPor: number | null;
  creadaPorNombre: string | null;
  createdAt: string;
  updatedAt: string;
  adjuntos: AdjuntoIncidencia[];
}

/** Lo que manda el formulario. `null` borra el campo; sin la clave, no se toca. */
export interface DatosIncidencia {
  ocurrioAt?: string;
  crm?: 'multicrm' | 'iseie';
  projectId?: number | null;
  sociedadId?: number | null;
  tipos?: TipoIncidencia[];
  causadaPor?: number | null;
  detectadaPor?: number | null;
  entidadTipo?: EntidadTipo | null;
  entidadId?: number | null;
  quePaso?: string;
  impacto?: string | null;
  comoSeArreglo?: string | null;
  arregladaPor?: number | null;
  arregladaAt?: string | null;
  gravedad?: Gravedad;
  estado?: EstadoIncidencia;
}

export interface FiltrosIncidencias {
  estado?: EstadoIncidencia;
  tipo?: TipoIncidencia;
  causadaPor?: number;
  projectId?: number | null;
  issuerId?: number | null;
}

export interface FilaPorPersona {
  userId: number | null;
  nombre: string | null;
  total: number;
  capa8: number;
  fallo_crm: number;
  dato_mal: number;
  externo: number;
}

export interface MetricasIncidencias {
  total: number;
  porPersona: FilaPorPersona[];
  porTipo: { tipo: TipoIncidencia; total: number }[];
  porMes: (Omit<FilaPorPersona, 'userId' | 'nombre'> & { mes: string })[];
}

export const POR_PAGINA = 200;

/** Sin los vacíos: un `projectId=null` en la dirección es un 400. */
function parametros(f: object): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(f).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ) as Record<string, string | number>;
}

export const incidenciasApi = {
  /** De 200 en 200; `page` empieza en 1. */
  listar: (f: FiltrosIncidencias = {}, page = 1) =>
    client.get<Incidencia[]>('/incidencias', { params: parametros({ ...f, limit: POR_PAGINA, page }) }),

  /** Con los MISMOS filtros que la lista, para que el total sea el mismo. */
  metricas: (f: FiltrosIncidencias & { meses?: number } = {}) =>
    client.get<MetricasIncidencias>('/incidencias/metricas', { params: parametros(f) }),

  /** Quien se puede poner como causante, detector o quien la arregló (lo decide el servidor). */
  personas: () => client.get<{ id: number; nombre: string }[]>('/incidencias/personas'),

  porId: (id: number) => client.get<Incidencia>(`/incidencias/${id}`),

  crear: (datos: DatosIncidencia) => client.post<Incidencia>('/incidencias', datos),

  editar: (id: number, datos: DatosIncidencia) => client.patch<Incidencia>(`/incidencias/${id}`, datos),

  subirAdjunto: (id: number, fichero: File) => {
    const fd = new FormData();
    fd.append('file', fichero);
    return client.post<AdjuntoIncidencia>(`/incidencias/${id}/adjuntos`, fd);
  },

  /**
   * Abre un adjunto en otra pestaña.
   *
   * Por `fetch` con la sesión, no con un enlace: la ruta pide sesión y
   * comprueba que la incidencia es de quien la abre, y un `<a href>` o un
   * `<img src>` no llevan la cabecera de la sesión.
   */
  async abrirAdjunto(adjuntoId: number): Promise<void> {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/incidencias/adjuntos/${adjuntoId}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    // Lo bastante para que la pestaña nueva lo cargue.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
