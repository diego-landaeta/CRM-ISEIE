import client from '@/shared/api/client';

// El panel de claves, tarea #80.
//
// `revelar` es una llamada aparte del listado a proposito: el listado NUNCA
// trae el valor entero, y pedirlo deja rastro en el servidor. No se cachea ni
// se guarda en estado global — se pide, se enseña y se olvida.

export interface Credencial {
  id: number;
  service: string;
  project_id: number | null;
  project_nombre: string | null;
  entorno: 'produccion' | 'pruebas';
  /** Los cuatro ultimos caracteres. Nunca el valor. */
  cola: string | null;
  puesta_por: string | null;
  last_used_at: string | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  updated_at: string;
}

export interface Hueco {
  project_id: number | null;
  project_nombre: string | null;
  service: string;
  falta_en: 'produccion' | 'pruebas';
  esta_en: 'produccion' | 'pruebas';
}

export interface LineaRegistro {
  id: number;
  action: string;
  details: { id?: number; servicio?: string; project_id?: number | null; entorno?: string };
  created_at: string;
  usuario: string | null;
}

export const credencialesApi = {
  listar: () => client.get('/credentials'),
  /** Lo que le falta a un entorno y el otro sí tiene. */
  paridad: () => client.get('/credentials/paridad'),
  registro: (limit = 100) => client.get(`/credentials/registro?limit=${limit}`),
  /** Saca el valor entero de UNA. Queda registrado quién y cuándo. */
  revelar: (id: number) => client.get(`/credentials/${id}/revelar`),
  guardar: (datos: { project_id: number | null; service: string; value: string; entorno: string }) =>
    client.post('/credentials', datos),
  borrar: (id: number) => client.delete(`/credentials/${id}`),
};
