import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/api/client';

// Registro automático de cobros (#766): PayPal y los extractos del banco.

export interface EstadoCobrosExternos { paypal: boolean; santander: boolean }

export interface CobroPaypal {
  id: number;
  project_id: number;
  paypal_id: string;
  tipo: 'cobro' | 'reembolso';
  status: string;
  amount: string;
  currency: string;
  fee_amount: string | null;
  customer_email: string | null;
  customer_name: string | null;
  invoice_id: string | null;
  custom_id: string | null;
  paypal_created_at: string;
  conversion_id: number | null;
  conversion_payment_id: number | null;
  link_method: string | null;
  llegado_por: string | null;
  lead_nombre: string | null;
  producto_contratado: string | null;
}

export interface CandidatoBanco {
  conversion_id: number;
  lead_id: number;
  nombre: string;
  producto: string | null;
  pendiente: number;
  motivos: Array<'nombre' | 'importe'>;
}

export interface MovimientoBanco {
  id: number;
  project_id: number;
  cuenta: string | null;
  fecha_operacion: string;
  importe: string;
  concepto: string | null;
  referencia: string | null;
  estado: 'enlazado' | 'a_revisar' | 'sin_candidato' | 'descartado' | 'enlazando';
  candidatos: CandidatoBanco[];
  conversion_id: number | null;
  link_method: string | null;
  lead_nombre: string | null;
  producto_contratado: string | null;
}

export interface ExtractoBanco {
  id: number;
  formato: 'n43' | 'csv';
  nombre_fichero: string | null;
  cuenta: string | null;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  movimientos: number;
  abonos: number;
  abonos_nuevos: number;
  enlazados: number;
  a_revisar: number;
  created_at: string;
  subido_por_nombre: string | null;
}

export interface ResumenImportacion {
  movimientos: number; abonos: number; nuevos: number; repetidos: number; otraMoneda: number;
  enlazados: number; yaApuntados: number; aRevisar: number; sinCandidato: number; liquidaciones: number;
}

export const cobrosExternosApi = {
  estado: () => client.get('/cobros-externos/estado') as Promise<ApiResponse<EstadoCobrosExternos>>,

  paypal: (qs: URLSearchParams) =>
    client.get(`/cobros-externos/paypal?${qs}`) as Promise<ApiResponse<CobroPaypal[]>>,
  sincronizarPaypal: (projectId: number) =>
    client.post('/cobros-externos/paypal/sincronizar', { projectId }) as Promise<ApiResponse<{ importados: number; enlazados: number; reintentados: number }>>,
  enlazarPaypal: (id: number, conversionId: number) =>
    client.post(`/cobros-externos/paypal/${id}/enlazar`, { conversionId }) as Promise<ApiResponse<{ paymentId: number }>>,

  movimientos: (qs: URLSearchParams) =>
    client.get(`/cobros-externos/banco/movimientos?${qs}`) as Promise<ApiResponse<MovimientoBanco[]> & { porEstado?: Record<string, number> }>,
  extractos: (qs: URLSearchParams) =>
    client.get(`/cobros-externos/banco/extractos?${qs}`) as Promise<ApiResponse<ExtractoBanco[]>>,
  subirExtracto: (projectId: number, fichero: File) => {
    const fd = new FormData();
    fd.append('file', fichero);
    return client.post(`/cobros-externos/banco/extractos?projectId=${projectId}`, fd) as Promise<ApiResponse<ResumenImportacion>>;
  },
  confirmar: (id: number, conversionId: number) =>
    client.post(`/cobros-externos/banco/movimientos/${id}/confirmar`, { conversionId }) as Promise<ApiResponse<{ paymentId: number }>>,
  descartar: (id: number) =>
    client.post(`/cobros-externos/banco/movimientos/${id}/descartar`, {}) as Promise<ApiResponse<{ descartado: boolean }>>,
};
