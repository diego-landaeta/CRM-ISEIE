import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';

/** El informe mensual de ventas y el ZIP de facturas para la gestoría (#772). */

export interface CifrasDelMes {
  leads: number; ventas: number; vendido: number; cobrado: number;
  cobros: number; facturado: number; pendiente: number;
}
export interface Comercial extends CifrasDelMes { id: number | null; nombre: string; equipo: string; tasa_conversion: number }
export interface Equipo extends CifrasDelMes { equipo: string; lider: string | null; comerciales: number }
export interface InformeMensual {
  periodo: string; mes: string; desde: string; hasta: string;
  comerciales: Comercial[]; equipos: Equipo[]; total: CifrasDelMes;
  envio: { activo: boolean; dia: number; hora: string; con_destinatarios: boolean };
}

const query = (o: Record<string, string | number | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Una descarga con su propio fetch: `client` lee como texto lo que no es JSON y el binario se rompía. */
async function bajar(ruta: string, nombre: string) {
  const t = getAccessToken();
  const r = await fetch(`${API_BASE_URL}${ruta}`, {
    credentials: 'include',
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.error || 'No se pudo preparar la descarga. Inténtalo de nuevo.');
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const informeMensualApi = {
  ver: (periodo: string, issuerId?: number | null) =>
    client.get(`/informe-mensual${query({ periodo, issuerId })}`) as Promise<{ success: boolean; data: InformeMensual }>,
  bajarExcel: (periodo: string, issuerId: number | null, empresa: string | null) =>
    bajar(`/informe-mensual/excel${query({ periodo, issuerId })}`, `informe-ventas_${periodo}${empresa ? `_${empresa}` : ''}.xlsx`),
  bajarZip: (periodo: string, issuerId: number, empresa: string) =>
    bajar(`/informe-mensual/zip${query({ periodo, issuerId })}`, `facturas-e-informe_${periodo}_${empresa}.zip`),
};
