import client, { getAccessToken } from '@/shared/api/client';

export interface InvoiceItem {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
}

export interface Issuer {
  id: number;
  project_id: number | null;
  razon_social: string;
  // Nombre corto para el selector cuando dos emisoras comparten razón social
  // (misma sociedad, distinto logo). No se imprime en la factura.
  alias?: string | null;
  nif: string;
  direccion: string | null;
  ciudad: string | null;
  cp: string | null;
  pais: string | null;
  email: string | null;
  telefono: string | null;
  iban: string | null;
  serie: string | null;
  logo_url: string | null;
  pie_default: string | null;
  activo: boolean;
  es_default: boolean;
  fiscal_status?: { ready: boolean; missing: string[] };
}

export interface CreateInvoiceBody {
  projectId: number;
  conversionId?: number;
  leadId?: number;
  issuerId?: number;
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
  leyendaIva?: string | null;
  notas?: string;
  metodoPago: 'transferencia' | 'tarjeta' | 'tarjeta_stripe' | 'efectivo' | 'bizum' | 'paypal' | 'fraccionado' | 'otro';
  /** Empresa o particular. Decide el rótulo del cliente en el PDF. */
  clienteTipo?: 'empresa' | 'particular';
  piePago?: string;
  /** Moneda de la factura (ISO). Importes manuales en esa divisa, sin conversión. Default EUR. */
  moneda?: string;
  /** Obligatorio si moneda != EUR: importe total en euros (contabilidad). */
  totalEur?: number | null;
  tipo?: 'normal' | 'proforma';
  /** true = crear como BORRADOR (sin numero fiscal, datos fiscales opcionales) */
  borrador?: boolean;
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
  codigo: string | null;
  ano: number;
  numero: number | null;
  fecha_emision: string;
  fecha_pago: string | null;
  cliente_nombre: string;
  /** 'empresa' o 'particular'. Decide el rótulo del cliente en el PDF. */
  cliente_tipo?: string | null;
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
  estado: 'borrador' | 'emitida' | 'enviada' | 'pagada' | 'cancelada';
  /** Solo en GET /:id de un borrador: qué falta para poder emitir. */
  faltantes?: string[];
  sent_at: string | null;
  notas?: string | null;
  leyenda_iva?: string | null;
  items?: InvoiceItem[];
  conversion_id?: number | null;
  lead_id?: number | null;
  tipo?: 'normal' | 'rectificativa' | 'proforma';
  rectifica_id?: number | null;
  rectifica_codigo?: string | null;
  motivo_rectificacion?: string | null;
  // Vista por sociedad
  project_id?: number | null;
  proyecto_nombre?: string | null;
  issuer_id?: number | null;
  issuer_razon_social?: string | null;
  /** Origen del cobro (p.ej. 'tarjeta_stripe' → factura generada por un pago Stripe). */
  metodo_pago?: string | null;
  moneda?: string | null;
  /** Importe en la divisa internacional (manual). El total va siempre en euros. */
  total_divisa?: number | string | null;
  /** Gestora responsable del lead de la factura. */
  gestora_nombre?: string | null;
}

export interface LeadConversion {
  id: number;
  producto_contratado: string | null;
  producto_contratado_id: number | null;
  importe_total: number | string | null;
  importe_pagado: number | string | null;
  metodo_pago: string | null;
  fecha_conversion: string | null;
  producto_nombre: string | null;
  producto_precio: number | string | null;
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
  conversiones?: LeadConversion[];
}

export interface FiscalRegimen {
  id: number;
  project_id: number | null;
  clave: string | null;
  nombre: string;
  aplica_iva: boolean;
  iva_pct: number;
  coletilla: string | null;
  orden: number;
  activo: boolean;
}

export interface TemplateBlock {
  id: string;
  type: 'logo' | 'emisor' | 'cliente' | 'meta' | 'items' | 'totales' | 'pie' | 'texto' | 'coletilla';
  x: number; y: number; w: number; h: number;
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  color?: string;
  text?: string;
  // Encabezados editables de la tabla de ítems (bloque 'items').
  cols?: { desc?: string; cant?: string; precio?: string; total?: string };
}
export interface InvoiceTemplate {
  id: number;
  project_id: number | null;
  issuer_id: number | null;
  issuer_nombre?: string | null;
  nombre: string;
  page_size: string;
  layout: TemplateBlock[];
  es_default: boolean;
  activo: boolean;
  condicion_pais: string | null; // null/'todos' | 'espana' | 'extranjero'
}

export interface VentaSinFactura {
  conversion_id: number;
  lead_id: number;
  cliente_nombre: string;
  /** 'empresa' o 'particular'. Decide el rótulo del cliente en el PDF. */
  cliente_tipo?: string | null;
  producto_contratado: string | null;
  importe_total: number;
  fecha_conversion: string | null;
  metodo_pago: string | null;
}

export const invoicesApi = {
  list: (params: { projectId?: number; issuerId?: number; estado?: string; search?: string; from?: string; to?: string; tipo?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v != null && v !== '' && qs.set(k, String(v)));
    return client.get<Invoice[]>(`/invoices?${qs}`);
  },
  stats: (params: { projectId?: number | null; issuerId?: number | null }) => {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set('projectId', String(params.projectId));
    if (params.issuerId) qs.set('issuerId', String(params.issuerId));
    return client.get<{ total: number; emitidas: number; enviadas: number; pagadas: number; canceladas: number; total_facturado: number; total_cobrado: number; total_iva: number }>(`/invoices/stats?${qs}`);
  },
  ventasSinFactura: (projectId: number) => client.get<VentaSinFactura[]>(`/invoices/ventas-sin-factura?projectId=${projectId}`),
  get: (id: number) => client.get<Invoice>(`/invoices/${id}`),
  byConversion: (conversionId: number) => client.get<Invoice | null>(`/invoices/by-conversion/${conversionId}`),
  leadFiscalData: (leadId: number) => client.get<LeadFiscalData>(`/invoices/lead-fiscal/${leadId}`),
  create: (body: CreateInvoiceBody) => client.post<Invoice>('/invoices', body),
  /** Editar una factura en BORRADOR (solo admin/superadmin). */
  update: (id: number, body: Partial<CreateInvoiceBody> & { fechaEmision?: string }) => client.patch<Invoice>(`/invoices/${id}`, body),
  // Ruta absoluta para <a>/window.open: incluye el base path del deploy
  // (/crm/ en prod, /testeo/ en staging, / en ISEIE) — si no, nginx da 404.
  pdfUrl: (id: number) => `${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/api/invoices/${id}/pdf`,
  // Abre el PDF descargandolo CON el token (una navegacion normal de pestana NO
  // manda el header Authorization -> daria 401). Lo abre como blob URL.
  /** vista='gestor' → copia con el importe NETO liquidado por Stripe (no la del alumno).
   *  enEuros → la misma factura totalizada en euros, no en su divisa. */
  openPdf: async (id: number, preliminar = false, vista?: 'gestor', enEuros = false): Promise<void> => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const tok = getAccessToken();
    const qs = preliminar ? '?preliminar=1'
      : vista === 'gestor' ? '?vista=gestor'
      : enEuros ? '?moneda=eur' : '';
    const res = await fetch(`${base}/api/invoices/${id}/pdf${qs}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    });
    if (!res.ok) {
      let msg = 'No se pudo abrir el PDF';
      try { const j = await res.json(); msg = j.error || msg; } catch { /* noop */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  // Descarga el PDF como archivo (attachment). preliminar=true fuerza la vista
  // previa con marca de agua (no exige datos completos del cliente).
  downloadPdf: async (id: number, filename: string, preliminar = false, forzar = false, vista?: 'gestor'): Promise<void> => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const tok = getAccessToken();
    const qs = preliminar ? '?preliminar=1' : (vista === 'gestor' ? (forzar ? '?vista=gestor&forzar=1' : '?vista=gestor') : (forzar ? '?forzar=1' : ''));
    const res = await fetch(`${base}/api/invoices/${id}/pdf${qs}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      credentials: 'include',
    });
    if (!res.ok) {
      let msg = 'No se pudo descargar el PDF';
      try { const j = await res.json(); msg = j.error || msg; } catch { /* noop */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (!blob || blob.size === 0) throw new Error('El PDF llegó vacío. Vuelve a intentarlo.');
    const url = URL.createObjectURL(blob);
    // El enlace DEBE estar en el documento: si se hace click sobre un <a> suelto,
    // algunos navegadores lo ignoran en silencio y la descarga "no hace nada".
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);
  },
  send: (id: number, email?: string) => client.post(`/invoices/${id}/send`, email ? { email } : {}),
  markPaid: (id: number, fechaPago?: string) => client.post(`/invoices/${id}/mark-paid`, fechaPago ? { fechaPago } : {}),
  cancel: (id: number) => client.post(`/invoices/${id}/cancel`, {}),
  // Eliminar factura + liberar su número (errores de carga) — admin/superadmin.
  remove: (id: number) => client.delete<{ id: number; codigo: string | null }>(`/invoices/${id}`),
  rectificar: (id: number, body: { motivo: string; parcial?: number | null; issuerId?: number }) => client.post<Invoice>(`/invoices/${id}/rectificar`, body),
  // Corregir una factura ya emitida/pagada (IVA, datos, concepto) — admin only.
  corregir: (id: number, body: {
    exento?: boolean; ivaPct?: number; ivaIncluido?: boolean;
    items?: InvoiceItem[];
    clienteNombre?: string; clienteNif?: string; clienteDireccion?: string;
    clienteCiudad?: string; clienteCp?: string; clientePais?: string;
    clienteEmail?: string; clienteTelefono?: string;
  }) => client.patch<Invoice>(`/invoices/${id}/corregir`, body),
  /** Cambiar SOLO las fechas (emisión y/o pago) de una factura — admin o permiso editar_fechas_factura. */
  updateFechas: (id: number, body: { fechaEmision?: string; fechaPago?: string }) => client.patch<Invoice>(`/invoices/${id}/fechas`, body),
  /** Asociar una factura existente a una venta (conversión) del cliente — Opción B. */
  asociarVenta: (id: number, conversionId: number) => client.patch<Invoice>(`/invoices/${id}/asociar`, { conversionId }),
  /** Validar y emitir un borrador (opcionalmente completando datos del cliente). */
  emitir: (id: number, patch?: Partial<{ clienteNombre: string; clienteNif: string; clienteDireccion: string; clienteCiudad: string; clienteCp: string; clientePais: string; clienteEmail: string | null; clienteTelefono: string | null }>) => client.post<Invoice>(`/invoices/${id}/emitir`, patch || {}),
  getOne: (id: number) => client.get<Invoice>(`/invoices/${id}`),
  /** Completar datos fiscales del cliente en una factura YA emitida (auto-emitida al pagar). */
  completarDatos: (id: number, patch: Partial<{ clienteNombre: string; clienteNif: string; clienteDireccion: string; clienteCiudad: string; clienteCp: string; clientePais: string; clienteEmail: string | null; clienteTelefono: string | null }>) => client.post<Invoice>(`/invoices/${id}/completar-datos`, patch),
  listIssuers: (projectId?: number) => client.get<Issuer[]>(`/invoices/issuers${projectId ? `?projectId=${projectId}` : ''}`),
  createIssuer: (body: Partial<Issuer> & { razonSocial: string; nif: string; projectId?: number | null }) => client.post<Issuer>('/invoices/issuers', body),
  updateIssuer: (id: number, body: Record<string, unknown>) => client.patch<Issuer>(`/invoices/issuers/${id}`, body),
  deleteIssuer: (id: number) => client.delete(`/invoices/issuers/${id}`),
  uploadIssuerLogo: (id: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return client.post<Issuer>(`/invoices/issuers/${id}/logo`, fd);
  },
  deleteIssuerLogo: (id: number) => client.delete<Issuer>(`/invoices/issuers/${id}/logo`),
  listRegimenes: (projectId: number) => client.get<FiscalRegimen[]>(`/invoices/regimenes?projectId=${projectId}`),
  resolveRegimen: (projectId: number, p: { productId?: number | null; pais?: string; cp?: string; provincia?: string; tipo?: string; vies?: boolean }) => {
    const q = new URLSearchParams({ projectId: String(projectId) });
    if (p.productId) q.set('productId', String(p.productId));
    if (p.pais) q.set('pais', p.pais);
    if (p.cp) q.set('cp', p.cp);
    if (p.provincia) q.set('provincia', p.provincia);
    if (p.tipo) q.set('tipo', p.tipo);
    if (p.vies) q.set('vies', 'true');
    return client.get<{ clave: string; regimen: FiscalRegimen | null }>(`/invoices/resolve-regimen?${q.toString()}`);
  },
  createRegimen: (body: Partial<FiscalRegimen> & { nombre: string }) => client.post<FiscalRegimen>('/invoices/regimenes', body),
  updateRegimen: (id: number, body: Record<string, unknown>) => client.patch<FiscalRegimen>(`/invoices/regimenes/${id}`, body),
  deleteRegimen: (id: number) => client.delete(`/invoices/regimenes/${id}`),
  listTemplates: (projectId: number) => client.get<InvoiceTemplate[]>(`/invoices/templates?projectId=${projectId}`),
  getTemplate: (id: number) => client.get<InvoiceTemplate>(`/invoices/templates/${id}`),
  createTemplate: (body: { projectId?: number | null; issuerId?: number | null; nombre?: string; pageSize?: string; layout?: TemplateBlock[]; esDefault?: boolean; condicionPais?: string | null }) => client.post<InvoiceTemplate>('/invoices/templates', body),
  updateTemplate: (id: number, body: Record<string, unknown>) => client.patch<InvoiceTemplate>(`/invoices/templates/${id}`, body),
  deleteTemplate: (id: number) => client.delete(`/invoices/templates/${id}`),
  getConfig: (projectId: number) => client.get<ProjectInvoicingConfig>(`/invoices/config?projectId=${projectId}`),
  updateConfig: (body: { projectId: number; piePagoDefault?: string; serieDefault?: string; metodoDefault?: string }) => client.patch('/invoices/config', body),
  listSequences: (projectId: number) => client.get<InvoiceSequence[]>(`/invoices/sequences?projectId=${projectId}`),
  setSequence: (body: { projectId: number; ano: number; serie: string; ultimoNumero: number }) => client.post('/invoices/sequences', body),
};

// Helper (frontend): campos fiscales del cliente que faltan en una factura.
// Espeja invoiceFaltantes del backend ('—' = placeholder de vacio).
export function invoiceFaltantes(inv: Partial<Invoice>): string[] {
  const vacio = (v?: string | null) => !v || String(v).trim() === '' || String(v).trim() === '—';
  const faltan: string[] = [];
  if (vacio(inv.cliente_nombre)) faltan.push('nombre');
  if (vacio(inv.cliente_nif)) faltan.push('NIF/DNI');
  if (vacio(inv.cliente_direccion)) faltan.push('dirección');
  if (vacio(inv.cliente_ciudad)) faltan.push('ciudad');
  if (vacio(inv.cliente_cp)) faltan.push('código postal');
  if (vacio(inv.cliente_pais)) faltan.push('país');
  return faltan;
}
