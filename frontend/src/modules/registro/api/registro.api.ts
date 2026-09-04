import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';

/** Una fila del registro, ya contada en cristiano por el servidor. */
export interface SucesoDelRegistro {
  id: string;
  fuente: string;
  cuando: string;
  usuario_id: number | null;
  usuario: string | null;
  project_id: number | null;
  accion: string;
  resumen: string;
  entidad: string | null;
  entidad_id: number | null;
  entidad_nombre: string | null;
  enlace: string | null;
  ok: boolean;
  detalle: Record<string, unknown> | null;
}

export interface Fuente {
  nombre: string;
  titulo: string;
  sistema: boolean;
  disponible: boolean;
}

export interface FiltrosDelRegistro {
  vista?: 'general' | 'todos';
  desde?: string;
  hasta?: string;
  usuarioId?: number;
  fuentes?: string[];
  busca?: string;
  limite?: number;
}

/** Los filtros, como van en la direccion. */
function comoParametros(f: FiltrosDelRegistro): URLSearchParams {
  const p = new URLSearchParams();
  if (f.vista) p.set('vista', f.vista);
  if (f.desde) p.set('desde', f.desde);
  if (f.hasta) p.set('hasta', f.hasta);
  if (f.usuarioId) p.set('usuarioId', String(f.usuarioId));
  if (f.fuentes?.length) p.set('fuentes', f.fuentes.join(','));
  if (f.busca) p.set('busca', f.busca);
  if (f.limite) p.set('limite', String(f.limite));
  return p;
}

export const registroApi = {
  listar: (f: FiltrosDelRegistro = {}) =>
    client.get(`/registro?${comoParametros(f).toString()}`),

  fuentes: () => client.get('/registro/fuentes'),

  /**
   * Descarga el CSV de LO QUE SE ESTA MIRANDO.
   *
   * Se le pasan los mismos filtros a proposito: una descarga que trajera otra
   * cosa que la pantalla es la forma mas rapida de que alguien mande un informe
   * con datos que no son los que vio.
   *
   * Va por `fetch` y no por el cliente porque el cliente parsea JSON, y esto es
   * un blob.
   */
  async descargarCsv(f: FiltrosDelRegistro = {}): Promise<void> {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/registro/csv?${comoParametros(f).toString()}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registro-${f.vista || 'general'}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};
