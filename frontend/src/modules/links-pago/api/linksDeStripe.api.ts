import client from '@/shared/api/client';

/*
  Links creados directamente en Stripe y sus cobros por vincular (CRM-ISEIE#688, gemela de CRM#1019).
  Todo con «Ver los links de todos» (`links_pago.ver_todos`), en sus campus.
*/

type Ambito = { projectId?: number; issuerId?: number };

export interface LinkDeStripe {
  id: number;
  project_id: number;
  project_nombre: string | null;
  stripe_payment_link_id: string;
  url: string | null;
  activo: boolean;
  nombre: string | null;
  importe: string | number | null;
  moneda: string | null;
  codigos_promocionales: boolean;
  visto_el: string;
  actualizado_el: string;
  cobros: number;
  cobrado: number;
  por_vincular: number;
}

export interface CandidataDeVenta {
  conversion_id?: number;
  lead_id: number;
  lead_nombre: string | null;
  producto?: string | null;
  importe_total?: number;
  pendiente?: number;
  email?: string | null;
}

export interface CobroPorVincular {
  id: number;
  project_id: number;
  project_nombre: string | null;
  stripe_id: string;
  importe: number;
  moneda: string | null;
  cobrado_el: string;
  email: string | null;
  nombre: string | null;
  telefono: string | null;
  descuento: number | null;
  codigo: string | null;
  motivo: string | null;
  motivo_texto: string;
  candidatos: CandidataDeVenta[];
  link_id: number;
  link_nombre: string | null;
  link_url: string | null;
}

export function listarLinksDeStripe(ambito: Ambito = {}) {
  return client.get<LinkDeStripe[]>('/links-pago/externos', { params: { ...ambito } });
}

export function traerDeStripe(projectId: number) {
  return client.post<{ project_id: number; links: number; nuevos: number; cobros: number }>(
    '/links-pago/externos/sincronizar', { projectId });
}

export function cobrosPorVincular(ambito: Ambito = {}) {
  return client.get<CobroPorVincular[]>('/links-pago/por-vincular', { params: { ...ambito } });
}

export function buscarVentasParaVincular(cargoId: number, q: string) {
  return client.get<CandidataDeVenta[]>('/links-pago/por-vincular/ventas', { params: { cargoId, q } });
}

export function vincularCobro(cargoId: number, conversionId: number) {
  return client.post<{ conversion_id: number; conversion_payment_id: number | null }>(
    `/links-pago/por-vincular/${cargoId}/vincular`, { conversionId });
}
