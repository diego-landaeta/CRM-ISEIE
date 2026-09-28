import client from '@/shared/api/client';

/** Una opción de «¿por qué has desistido?». La clave es lo que se guarda. */
export type MotivoFeedback = { clave: string; texto: string };

export type TotalesFeedback = {
  enviados: number; respondidos: number; tasa: number;
  en_revision: number; bloqueados: number; sin_correo: number; fallidos: number;
};

/** Una pregunta de la encuesta, resumida para el panel. */
export type ResumenPregunta = {
  clave: string; tipo: 'unica' | 'varias' | 'escala' | 'texto'; texto: string; respondieron: number;
  opciones?: Array<{ clave: string; texto: string; n: number }>;
  media?: number | null;
  escritos?: Array<{ texto: string; lead_id: number; lead_nombre: string | null; gestora: string | null; fecha: string }>;
};

/** Lo que contestó una persona, por clave de pregunta. */
export type RespuestasFeedback = Record<string, string | number | string[]>;

export type PanelFeedback = {
  totales: TotalesFeedback;
  porMotivo: Array<{ clave: string; n: number }>;
  porDisparador: Array<{ clave: string; enviados: number; respondidos: number }>;
  porCampus: Array<{ project_id: number; nombre: string; enviados: number; respondidos: number }>;
  porGestora: Array<{ gestora_id: number | null; nombre: string; enviados: number; respondidos: number; no_le_contestaron: number;
    nota_atencion: string | number | null; notas: number }>;
  porMes: Array<{ mes: string; enviados: number; respondidos: number }>;
  motivos: MotivoFeedback[];
  disparadores: Record<string, string>;
  preguntas: ResumenPregunta[];
};

export type FilaFeedback = {
  id: number; lead_id: number; lead_nombre: string | null; email: string | null;
  project_id: number; proyecto: string | null; gestora: string | null;
  disparador: string; estado: string; enviado_at: string | null; respondido_at: string | null;
  motivo: string | null; comentario: string | null; nota_envio: string | null; created_at: string;
  respuestas?: RespuestasFeedback;
};

export type EnvioDeUnLead = {
  id: number; estado: string; disparador: string; email: string | null;
  enviado_at: string | null; respondido_at: string | null;
  motivo: string | null; comentario: string | null; nota_envio: string | null;
  respuestas?: RespuestasFeedback;
  /** Las preguntas, para poder decir a qué contestó cada cosa. */
  preguntas?: Array<{ clave: string; tipo: string; texto: string; opciones?: Array<{ clave: string; texto: string }> }>;
} | null;

export async function traerPanel(params: URLSearchParams): Promise<PanelFeedback | null> {
  const r = await client.get(`/feedback/panel?${params.toString()}`);
  return r?.success ? r.data : null;
}

export async function traerLista(params: URLSearchParams): Promise<FilaFeedback[]> {
  const r = await client.get(`/feedback/lista?${params.toString()}`);
  return r?.success ? (r.data || []) : [];
}

export async function envioDeUnLead(leadId: number): Promise<EnvioDeUnLead> {
  const r = await client.get(`/feedback/lead/${leadId}`);
  return r?.success ? r.data : null;
}

export async function enviarLoRevisado(leadId: number) {
  return client.post(`/feedback/lead/${leadId}/enviar`, {});
}

export async function noEnviar(leadId: number) {
  return client.post(`/feedback/lead/${leadId}/no-enviar`, {});
}
