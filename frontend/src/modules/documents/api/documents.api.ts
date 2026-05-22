import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export type DocumentType = 'invoice' | 'certificate';

export type DocumentStatus = 'draft' | 'issued' | 'paid' | 'cancelled';

export interface InvoiceData {
  client_nombre?: string;
  client_dni?: string;
  client_direccion?: string;
  concept?: string;
  items?: Array<{ description: string; qty: number; unit_price: number }>;
  iva_percent?: number;
  total?: number;
  notes?: string;
  [key: string]: unknown;
}

export interface CertificateData {
  client_nombre?: string;
  client_dni?: string;
  course_name?: string;
  hours?: number;
  start_date?: string;
  end_date?: string;
  signed_by?: string;
  [key: string]: unknown;
}

export type DocumentData = InvoiceData | CertificateData | Record<string, unknown>;

export interface CrmDocument {
  id: number;
  project_id: number;
  type: DocumentType;
  number: string;
  client_nombre?: string;
  client_email?: string;
  data: DocumentData;
  pdf_url?: string;
  status?: DocumentStatus;
  created_at: string;
  updated_at?: string;
  created_by_nombre?: string;
}

export interface PreviewResult {
  html?: string;
  pdf_base64?: string;
  url?: string;
}

export const documentsApi = {
  list: (projectId: number, type?: DocumentType): Promise<ApiResponse<CrmDocument[]>> =>
    client.get(`/documents?projectId=${projectId}${type ? `&type=${type}` : ''}`),

  generate: (projectId: number, type: DocumentType, data: DocumentData, numeroOverride?: number): Promise<ApiResponse<CrmDocument>> =>
    client.post('/documents/generate', { projectId, type, data, numero_override: numeroOverride }),

  download: (id: number, projectId: number): Promise<Blob> =>
    client.get(`/documents/${id}/download?projectId=${projectId}`, { responseType: 'blob' }) as unknown as Promise<Blob>,

  remove: (id: number, projectId: number): Promise<ApiResponse<void>> =>
    client.delete(`/documents/${id}?projectId=${projectId}`),

  preview: (type: DocumentType, data: DocumentData): Promise<ApiResponse<PreviewResult>> =>
    client.post('/documents/preview', { type, data }),

  // Peek: siguiente numero sin incrementar el contador. Para mostrar en el form.
  nextNumber: (projectId: number, type: DocumentType): Promise<ApiResponse<{ number: number; formatted: string }>> =>
    client.get(`/documents/next-number?projectId=${projectId}&type=${type}`),

  // Reposiciona el contador (ajustes de "inicio de factura"). El proximo numero
  // generado sera exactamente `value`, y la sucesion continuara desde ahi.
  setNumber: (projectId: number, type: DocumentType, value: number): Promise<ApiResponse<{ next: number }>> =>
    client.post('/documents/set-number', { projectId, type, value }),

  // Regenera el PDF de un documento existente desde su `data` con el template
  // actual. Mantiene el `number`. Util tras cambios visuales del template.
  regenerate: (id: number, projectId: number): Promise<ApiResponse<{ id: number; number: string; file_path: string }>> =>
    client.post(`/documents/${id}/regenerate?projectId=${projectId}`, {}),

  // Audit log de un documento — solo superadmin. Lista de eventos
  // (generated/downloaded/regenerated/deleted/number_overridden/emailed).
  audit: (id: number, projectId: number): Promise<ApiResponse<AuditEntry[]>> =>
    client.get(`/documents/${id}/audit?projectId=${projectId}`),

  // Reenvía el documento por email al cliente/alumno. El destinatario sale
  // del campo cliente_email/alumno_email guardado en doc.data.
  resendEmail: (id: number, projectId: number): Promise<ApiResponse<{ sent: boolean; to: string; messageId: string }>> =>
    client.post(`/documents/${id}/resend-email?projectId=${projectId}`, {}),
};

export interface AuditEntry {
  id: number;
  action: 'generated' | 'downloaded' | 'regenerated' | 'deleted' | 'number_overridden' | 'emailed';
  user_id: number | null;
  user_nombre: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
