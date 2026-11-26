import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';
import type { EstadoApostilla, TipoDocumento } from '../lib/apostillas';

/*
  Apostillas de La Haya (CRM#1130 / CRM-ISEIE#786), contra `/api/apostillas`.
  Qué ve y qué gestiona cada uno lo decide el servidor: cada fila trae
  `gestionable` (puede cambiarla) y `ve_documentos` (puede abrir sus documentos).
*/

export interface Apostilla {
  id: number;
  project_id: number;
  campus: string;
  lead_id: number | null;
  cliente: string | null;
  cliente_email: string | null;
  conversion_id: number | null;
  conversion_item_id: number | null;
  stripe_payment_id: number | null;
  origen: 'venta' | 'stripe' | 'manual';
  estado: EstadoApostilla;
  estado_desde: string;
  responsable_id: number | null;
  responsable: string | null;
  gestora_id: number | null;
  gestora: string | null;
  formacion: string | null;
  direccion_envio: string | null;
  numero_seguimiento: string | null;
  notas: string | null;
  venta_producto: string | null;
  /** El correo con el que se pagó el cargo de Stripe (para enlazar las «Sin asociar»). */
  cobro_email: string | null;
  importe: number;
  cobrado: number;
  pagada: boolean;
  fecha: string;
  dias_en_estado: number;
  dias_aviso: number;
  created_at: string;
  gestionable: boolean;
  ve_documentos: boolean;
}

export interface EventoApostilla {
  id: number;
  tipo: 'creada' | 'estado' | 'responsable' | 'nota' | 'documento' | 'envio' | 'enlazada' | 'datos';
  de: string | null;
  a: string | null;
  nota: string | null;
  usuario: string | null;
  created_at: string;
}

export interface DocumentoApostilla {
  id: number;
  tipo: TipoDocumento;
  nombre: string;
  mime: string | null;
  bytes: number | null;
  subido_por: string | null;
  created_at: string;
}

export interface ApostillaConDetalle extends Apostilla {
  eventos: EventoApostilla[];
  documentos: DocumentoApostilla[];
}

export interface CifrasApostillas {
  total: number;
  vivas: number;
  importe: number;
  cobrado: number;
  pagadas: number;
  sin_asociar: number;
  atascadas: number;
  por_estado: Array<{ estado: EstadoApostilla; n: number; importe: number }>;
  por_campus: Array<{ project_id: number; campus: string; n: number; importe: number; cobrado: number }>;
  por_mes: Array<{ mes: string; n: number; importe: number; cobrado: number }>;
}

export interface AjusteApostillas { project_id: number; campus: string; dias_aviso: number }

export interface FiltrosApostillas {
  estado?: EstadoApostilla | '';
  sinAsociar?: boolean;
  atascadas?: boolean;
  mias?: boolean;
  q?: string;
  page?: number;
  limit?: number;
}

/** El ámbito (campus o empresa) y el rango, como en Reportes. */
export type Ambito = Record<string, string | number>;

function params(f: FiltrosApostillas & { from?: string; to?: string }, ambito: Ambito = {}) {
  const p: Record<string, string | number> = { ...ambito };
  if (f.estado) p.estado = f.estado;
  if (f.sinAsociar) p.sinAsociar = '1';
  if (f.atascadas) p.atascadas = '1';
  if (f.mias) p.mias = '1';
  if (f.q) p.q = f.q;
  if (f.from) p.from = f.from;
  if (f.to) p.to = f.to;
  if (f.page) p.page = f.page;
  if (f.limit) p.limit = f.limit;
  return p;
}

export interface EdicionApostilla {
  estado?: EstadoApostilla;
  responsableId?: number | null;
  formacion?: string | null;
  direccionEnvio?: string | null;
  numeroSeguimiento?: string | null;
  nota?: string | null;
}

export const apostillasApi = {
  listar: (f: FiltrosApostillas, ambito: Ambito) =>
    client.get('/apostillas', { params: params(f, ambito) }) as Promise<ApiResponse<Apostilla[]>>,
  cifras: (ambito: Ambito, rango: { from?: string; to?: string } = {}) =>
    client.get('/apostillas/cifras', { params: params(rango, ambito) }) as Promise<ApiResponse<CifrasApostillas>>,
  ver: (id: number) => client.get(`/apostillas/${id}`) as Promise<ApiResponse<ApostillaConDetalle>>,
  deCliente: (leadId: number) => client.get(`/apostillas/de-cliente/${leadId}`) as Promise<ApiResponse<Apostilla[]>>,
  deVenta: (conversionId: number) => client.get(`/apostillas/de-venta/${conversionId}`) as Promise<ApiResponse<Apostilla[]>>,
  personas: () => client.get('/apostillas/personas') as Promise<ApiResponse<Array<{ id: number; nombre: string }>>>,
  editar: (id: number, datos: EdicionApostilla) =>
    client.patch(`/apostillas/${id}`, datos) as Promise<ApiResponse<ApostillaConDetalle>>,
  crear: (datos: { projectId: number; leadId?: number | null; conversionId?: number | null; formacion?: string | null; nota?: string | null }) =>
    client.post('/apostillas', datos) as Promise<ApiResponse<Apostilla>>,
  enlazar: (id: number, datos: { leadId: number; conversionId?: number | null }) =>
    client.post(`/apostillas/${id}/enlazar`, datos) as Promise<ApiResponse<Apostilla>>,
  subirDocumento: (id: number, file: File, tipo: TipoDocumento) => {
    const fd = new FormData();
    fd.append('tipo', tipo);
    fd.append('file', file);
    return client.post(`/apostillas/${id}/documentos`, fd) as Promise<ApiResponse<DocumentoApostilla>>;
  },
  /**
   * Abre un documento en otra pestaña, por `fetch` con la sesión (como los
   * adjuntos de Incidencias): un `<a href>` no lleva la cabecera de la sesión.
   */
  async abrirDocumento(docId: number): Promise<void> {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/apostillas/documentos/${docId}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(res.status === 403 ? 'Los documentos los abre quien gestiona esta apostilla' : `HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  ajustes: () => client.get('/apostillas/ajustes') as Promise<ApiResponse<AjusteApostillas[]>>,
  guardarAjustes: (projectId: number, diasAviso: number) =>
    client.put('/apostillas/ajustes', { projectId, diasAviso }) as Promise<ApiResponse<AjusteApostillas[]>>,
};
