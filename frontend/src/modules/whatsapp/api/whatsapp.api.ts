import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export interface PlantillaWhatsapp {
  id: number;
  project_id: number;
  label: string;
  body: string;
  ambito: 'compartida' | 'personal';
  owner_id: number | null;
  orden: number;
  creada_por?: string | null;
}

export interface ProspectoCola {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  status: string;
  entrada: string;
  producto: string;
  gestora: string | null;
  ultimo_contacto: string | null;
  contactos: number;
}

type Params = Record<string, string | number | null | undefined> | undefined;

const qs = (params: Params): string => {
  const limpio = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Record<string, string>;
  const s = new URLSearchParams(limpio).toString();
  return s ? `?${s}` : '';
};

export const whatsappApi = {
  plantillas: (projectId: number): Promise<ApiResponse<PlantillaWhatsapp[]>> =>
    client.get(`/whatsapp/templates${qs({ projectId })}`),

  crearPlantilla: (data: {
    projectId: number; label: string; body: string; ambito: 'compartida' | 'personal';
  }): Promise<ApiResponse<PlantillaWhatsapp>> => client.post('/whatsapp/templates', data),

  editarPlantilla: (id: number, data: { label?: string; body?: string }):
    Promise<ApiResponse<PlantillaWhatsapp>> => client.patch(`/whatsapp/templates/${id}`, data),

  borrarPlantilla: (id: number): Promise<ApiResponse<null>> =>
    client.delete(`/whatsapp/templates/${id}`),

  cola: (params: {
    projectId: number; responsableId?: number | null; estado?: string | null;
    sinContactar?: boolean;
  }): Promise<ApiResponse<ProspectoCola[]>> =>
    client.get(`/whatsapp/cola${qs({
      projectId: params.projectId,
      responsableId: params.responsableId,
      estado: params.estado,
      sinContactar: params.sinContactar ? '1' : undefined,
    })}`),

  // Registrar que se ha contactado. Va contra el endpoint de leads que ya
  // existe: no hace falta uno nuevo y así la interacción sale en la ficha.
  registrarContacto: (leadId: number, nota: string): Promise<ApiResponse<unknown>> =>
    client.post(`/leads/${leadId}/interactions`, {
      tipo: 'whatsapp', nota, fecha: new Date().toISOString(),
    }),
};
