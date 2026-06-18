import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';

export interface RfcSummary {
  id: number;
  codigo_rfc: string;
  titulo: string;
  estado: string;
  created_at: string;
  fecha_solicitud: string;
  project_id: number;
  proyecto_nombre?: string;
  proyecto_slug?: string;
  solicitante_nombre?: string;
  solicitante_email?: string;
  n_attachments: number;
}

export interface RfcDetail extends RfcSummary {
  solicitante_user_id: number | null;
  modifica_alcance: boolean;
  modifica_cronograma: boolean;
  modifica_costos: boolean;
  modifica_riesgos: boolean;
  descripcion_resumida: string | null;
  objetivo_intencion: string | null;
  motivo_negocio: string | null;
  beneficios_kpi: string | null;
  beneficios_comercial: string | null;
  beneficios_operacion: string | null;
  opciones_consideradas: Array<{ opcion?: string; descripcion?: string; alcance?: string; costo?: string; tiempo?: string; riesgos?: string; comentarios?: string }>;
  impacto_alcance: string | null;
  impacto_tiempo: string | null;
  impacto_costo: string | null;
  impacto_riesgos: string | null;
  recomendacion_decision: string | null;
  recomendacion_justif: string | null;
  plan_alcance: string | null;
  plan_hitos: string | null;
  plan_responsables: string | null;
  baseline_alcance: string | null;
  baseline_cronograma: string | null;
  baseline_costos: string | null;
  approvals: Array<{
    id: number;
    rol: 'ceo' | 'pm' | 'dev';
    decision: string | null;
    firma_at: string | null;
    comentarios: string | null;
    has_firma: boolean;
    user_id: number | null;
    user_nombre: string | null;
    user_email: string | null;
  }>;
  attachments: Array<{
    id: number;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    uploaded_at: string;
  }>;
}

export const rfcApi = {
  list(opts: { projectId?: number; estado?: string } = {}) {
    return client.get<RfcSummary[]>('/change-requests', { params: opts });
  },
  get(id: number) {
    return client.get<RfcDetail>(`/change-requests/${id}`);
  },
  create(payload: { projectId: number; titulo: string; descripcionResumida?: string; objetivoIntencion?: string; motivoNegocio?: string; beneficiosKpi?: string; beneficiosComercial?: string; beneficiosOperacion?: string; modificaAlcance?: boolean; modificaCronograma?: boolean; modificaCostos?: boolean; modificaRiesgos?: boolean }) {
    return client.post('/change-requests', payload);
  },
  update(id: number, patch: Partial<RfcDetail>) {
    return client.patch(`/change-requests/${id}`, patch);
  },
  approve(id: number, payload: { rol: 'ceo' | 'pm' | 'dev'; decision: 'a_favor' | 'en_contra' | 'diferir'; timing?: 'inmediato' | 'futuro'; firmaData?: string; comentarios?: string }) {
    return client.post(`/change-requests/${id}/approve`, payload);
  },
  getSignature(approvalId: number) {
    return client.get<{ firma_data: string | null }>(`/change-requests/approvals/${approvalId}/signature`);
  },
  remove(id: number) {
    return client.delete(`/change-requests/${id}`);
  },
  reopen(id: number, motivo: string) {
    return client.post(`/change-requests/${id}/reopen`, { motivo });
  },
  async uploadAttachment(id: number, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/change-requests/${id}/attachments`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    if (!res.ok) throw new Error(`Upload failed ${res.status}`);
    return res.json();
  },
  downloadAttachmentUrl(attachmentId: number) {
    return `${API_BASE_URL}/change-requests/attachments/${attachmentId}/download`;
  },
  deleteAttachment(attachmentId: number) {
    return client.delete(`/change-requests/attachments/${attachmentId}`);
  },
};

export const ESTADO_LABELS: Record<string, string> = {
  propuesto: 'Propuesto',
  en_analisis: 'En análisis',
  enviado_ceo: 'Enviado al CEO',
  aprobado: 'Aprobado',
  aprobado_inmediato: 'Aprobado · realización inmediata',
  aprobado_futuro: 'Aprobado · para realizar después',
  rechazado: 'Rechazado',
  diferido: 'Diferido',
};

export const ESTADO_COLORS: Record<string, string> = {
  propuesto: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  en_analisis: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  enviado_ceo: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  aprobado: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  aprobado_inmediato: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 ring-1 ring-emerald-500',
  aprobado_futuro: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300',
  rechazado: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  diferido: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
};
