import client from '@/shared/api/client';

export interface WidgetConfig {
  project_id: number;
  project_nombre: string;
  project_slug: string;
  enabled: boolean;
  welcome_text: string;
  message_template: string;
  excluded_user_ids: number[];
  show_bubble: boolean;
  bubble_delay_ms: number;
  /** Los otros idiomas (12/10): vacío = el texto por defecto de ese idioma. */
  traducciones?: Partial<Record<'en' | 'fr' | 'pt', { welcome?: string; template?: string }>>;
  updated_at: string;
}

export interface CandidateUser {
  id: number;
  nombre: string;
  email: string;
  role: string;
  active: boolean;
  whatsapp_phone: string | null;
  whatsapp_display_name: string | null;
  whatsapp_widget_active: boolean;
  in_project: boolean;
}

/** Las cifras del botón por gestora (widget.pulsaciones.js). */
export interface PulsacionesDeGestora {
  id: number;
  nombre: string;
  pulsaciones: number;
  /** Altas que dio ella con origen WhatsApp. */
  altas: number;
  /** De esas altas, las que tienen una pulsación suya de las 24 h anteriores. */
  con_pulsacion: number;
}
export interface ResumenPulsaciones {
  from: string;
  to: string;
  porGestora: PulsacionesDeGestora[];
  paginas: { pagina: string; pulsaciones: number; con_alta: number }[];
}

export const widgetApi = {
  pulsaciones: (projectId: number, from: string, to: string) =>
    client.get<ResumenPulsaciones>(`/widget/pulsaciones?projectId=${projectId}&from=${from}&to=${to}`),
  getConfig: (projectId: number) =>
    client.get<{ config: WidgetConfig; candidates: CandidateUser[] }>(`/widget/config?projectId=${projectId}`),
  updateConfig: (body: Partial<WidgetConfig> & { projectId: number }) =>
    client.patch('/widget/config', body),
  updateUserPhone: (userId: number, body: { whatsapp_phone?: string | null; whatsapp_display_name?: string | null; whatsapp_widget_active?: boolean }) =>
    client.patch(`/widget/users/${userId}/phone`, body),
};
