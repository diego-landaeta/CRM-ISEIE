import client from '@/shared/api/client';

/** Una fila de «Actividad por comercial» (#203). La misma forma que devuelve
 *  la herramienta de Claude, porque es la misma consulta. */
export interface FilaActividad {
  user_id: number | null;
  comercial: string;
  llamadas: number;
  whatsapp: number;
  whatsapp_texto: number;
  whatsapp_voz: number;
  correos: number;
  notas: number;
  personas: number;
  toques: number;
}

export interface Actividad {
  desde: string;
  hasta: string;
  filas: FilaActividad[];
  equipo: Omit<FilaActividad, 'user_id' | 'comercial'>;
}

export type TipoDeDetalle = 'llamada' | 'whatsapp' | 'email' | 'nota' | 'toques';

export interface ContactoDeDetalle {
  id: number;
  lead_id: number;
  lead: string;
  tipo: 'llamada' | 'whatsapp' | 'email' | 'nota';
  fecha: string;
  nota: string | null;
}

/** `ambito` es lo de `ambitoComoObjeto`: `{}`, `{ projectId }` o `{ issuerId }`.
 *  El recorte por rol lo hace el servidor: una gestora recibe solo su fila. */
export async function getActividad(
  ambito: { projectId?: number; issuerId?: number },
  desde: string,
  hasta: string,
): Promise<Actividad> {
  const p = new URLSearchParams({ desde, hasta });
  Object.entries(ambito).forEach(([k, v]) => p.set(k, String(v)));
  const r = await client.get(`/informes/actividad-comercial?${p.toString()}`);
  return r.data;
}

export async function getDetalleActividad(
  ambito: { projectId?: number; issuerId?: number },
  userId: number,
  tipo: TipoDeDetalle,
  desde: string,
  hasta: string,
): Promise<ContactoDeDetalle[]> {
  const p = new URLSearchParams({ desde, hasta, userId: String(userId), tipo });
  Object.entries(ambito).forEach(([k, v]) => p.set(k, String(v)));
  const r = await client.get(`/informes/actividad-comercial/detalle?${p.toString()}`);
  return r.data ?? [];
}
