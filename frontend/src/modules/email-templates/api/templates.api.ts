import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export interface EmailTemplate {
  id: number;
  project_id: number;
  name: string;
  subject: string;
  body_html: string;
  description?: string | null;
  active: boolean;
  created_by?: number | null;
  created_by_nombre?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateVariable {
  token: string;
  desc: string;
}

export interface TemplateRender {
  subject: string;
  body_html: string;
}

export const emailTemplatesApi = {
  list: (projectId: number, includeInactive = false): Promise<ApiResponse<EmailTemplate[]>> =>
    client.get(`/email-templates?projectId=${projectId}${includeInactive ? '&includeInactive=true' : ''}`),

  getById: (id: number, projectId: number): Promise<ApiResponse<EmailTemplate>> =>
    client.get(`/email-templates/${id}?projectId=${projectId}`),

  create: (projectId: number, data: { name: string; subject: string; body_html: string; description?: string }): Promise<ApiResponse<EmailTemplate>> =>
    client.post(`/email-templates?projectId=${projectId}`, data),

  update: (id: number, projectId: number, data: Partial<{ name: string; subject: string; body_html: string; description: string; active: boolean }>): Promise<ApiResponse<EmailTemplate>> =>
    client.patch(`/email-templates/${id}?projectId=${projectId}`, data),

  remove: (id: number, projectId: number): Promise<ApiResponse<void>> =>
    client.delete(`/email-templates/${id}?projectId=${projectId}`),

  variables: (): Promise<ApiResponse<TemplateVariable[]>> =>
    client.get('/email-templates/variables'),

  // Render con un leadId real o demo si no se pasa.
  render: (id: number, projectId: number, leadId?: number): Promise<ApiResponse<TemplateRender>> =>
    client.post(`/email-templates/${id}/render?projectId=${projectId}`, leadId ? { leadId } : {}),
};
