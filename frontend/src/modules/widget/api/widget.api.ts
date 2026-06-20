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

export const widgetApi = {
  getConfig: (projectId: number) =>
    client.get<{ config: WidgetConfig; candidates: CandidateUser[] }>(`/widget/config?projectId=${projectId}`),
  updateConfig: (body: Partial<WidgetConfig> & { projectId: number }) =>
    client.patch('/widget/config', body),
  updateUserPhone: (userId: number, body: { whatsapp_phone?: string | null; whatsapp_display_name?: string | null; whatsapp_widget_active?: boolean }) =>
    client.patch(`/widget/users/${userId}/phone`, body),
};
