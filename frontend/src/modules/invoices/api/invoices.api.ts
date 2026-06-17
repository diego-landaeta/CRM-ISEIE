import client from '@/shared/api/client';

export interface InvoiceItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
}

export interface CreateInvoiceBody {
  projectId: number;
  conversionId?: number;
  leadId?: number;
  clienteNombre: string;
  clienteNif: string;
  clienteDireccion: string;
  clienteCiudad: string;
  clienteCp: string;
  clientePais: string;
  clienteEmail?: string | null;
  clienteTelefono?: string | null;
  items: InvoiceItem[];
  ivaPct?: number;
  ivaIncluido?: boolean;
  notas?: string;
  metodoPago: 'transferencia' | 'tarjeta' | 'tarjeta_stripe' | 'efectivo' | 'bizum' | 'fraccionado' | 'otro';
  piePago?: string;
}

export interface ProjectInvoicingConfig {
  id: number;
  nombre: string;
  factura_pie_default: string | null;
  factura_serie_default: string;
  factura_metodo_default: string | null;
  datos_fiscales?: Record<string, unknown>;
}

export interface InvoiceSequence {
  ano: number;
  serie: string;
  ultimo_numero: number;
}

export interface Invoice {
  id: number;
  codigo: string;
  ano: number;
  numero: number;
  fecha_emision: string;
  fecha_pago: string | null;
  cliente_nombre: string;
  cliente_nif: string;
  cliente_direccion?: string;
  cliente_ciudad?: string;
  cliente_cp?: string;
  cliente_pais?: string;
  cliente_email: string | null;
  cliente_telefono?: string | null;
  total: number;
  base_imponible?: number;
  iva_pct: number;
  iva_importe?: number;
  iva_incluido?: boolean;
  estado: 'emitida' | 'enviada' | 'pagada' | 'cancelada';
  sent_at: string | null;
  notas?: string | null;
  leyenda_iva?: string | null;
  items?: InvoiceItem[];
  conversion_id?: number | null;
}

export interface LeadFiscalData {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  identificacion_fiscal: string | null;
  direccion_fiscal: string | null;
  ciudad_fiscal: string | null;
  codigo_postal_fiscal: string | null;
  pais_fiscal: string | null;
}

export const invoicesApi = {
  list: (params: { projectId: number; estado?: string; search?: string; from?: string; to?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && qs.set(k, String(v)));
    return client.get<Invoice[]>(`/invoices?${qs}`);
  },
  stats: (projectId: number) => client.get<{ total: number; emitidas: number; enviadas: number; pagadas: number; canceladas: number; total_facturado: number; total_cobrado: number; total_iva: number }>(`/invoices/stats?projectId=${projectId}`),
  get: (id: number) => client.get<Invoice>(`/invoices/${id}`),
  byConversion: (conversionId: number) => client.get<Invoice | null>(`/invoices/by-conversion/${conversionId}`),
  leadFiscalData: (leadId: number) => client.get<LeadFiscalData>(`/invoices/lead-fiscal/${leadId}`),
  create: (body: CreateInvoiceBody) => client.post<Invoice>('/invoices', body),
  pdfUrl: (id: number) => `/api/invoices/${id}/pdf`,
  send: (id: number, email?: string) => client.post(`/invoices/${id}/send`, email ? { email } : {}),
  markPaid: (id: number, fechaPago?: string) => client.post(`/invoices/${id}/mark-paid`, fechaPago ? { fechaPago } : {}),
  cancel: (id: number) => client.post(`/invoices/${id}/cancel`, {}),
  getConfig: (projectId: number) => client.get<ProjectInvoicingConfig>(`/invoices/config?projectId=${projectId}`),
  updateConfig: (body: { projectId: number; piePagoDefault?: string; serieDefault?: string; metodoDefault?: string }) => client.patch('/invoices/config', body),
  listSequences: (projectId: number) => client.get<InvoiceSequence[]>(`/invoices/sequences?projectId=${projectId}`),
  setSequence: (body: { projectId: number; ano: number; serie: string; ultimoNumero: number }) => client.post('/invoices/sequences', body),
};
