import client from '@/shared/api/client';

// El equipo comercial de una administradora (Carlos, 09/11/2026; migración 274):
// las gestoras que lleva y cuyos prospectos, ventas y gestión ve, además de lo
// suyo. Lo decide quien tenga `equipos.gestionar` (de serie, solo super admin).

export interface PersonaDelEquipo {
  id: number;
  nombre: string;
  role?: string;
  active?: boolean;
}

export interface Candidata {
  id: number;
  nombre: string;
  role: string;
  /** Los campus que comparte con la administradora. */
  campus: string[];
}

export interface EquipoComercial {
  lider: { id: number; nombre: string; role: string };
  gestoraIds: number[];
  gestoras: PersonaDelEquipo[];
  candidatas: Candidata[];
}

export async function leerEquipoComercial(userId: number): Promise<EquipoComercial | null> {
  const res = await client.get<EquipoComercial>(`/users/${userId}/equipo-comercial`);
  return res?.data ?? null;
}

export async function guardarEquipoComercial(userId: number, gestoraIds: number[]): Promise<EquipoComercial | null> {
  const res = await client.put<EquipoComercial>(`/users/${userId}/equipo-comercial`, { gestoraIds });
  return res?.data ?? null;
}
