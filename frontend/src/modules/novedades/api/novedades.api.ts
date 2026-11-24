import client from '@/shared/api/client';

export type Novedad = {
  titulo: string; texto: string; roles: string[];
  ruta: string | null; boton?: string | null;
  /** Id de su recorrido guiado: «Ver recorrido» lo abre en su pantalla (3.0.0). */
  recorrido?: string | null;
};
export type Version = {
  version: string; fecha: string; titulo: string; intro: string;
  grupos: Array<{ titulo: string; items: Novedad[] }>;
  arreglos: string[];
};
export type Novedades = { crm: { nombre: string; color: string }; actual: string; versiones: Version[] };
export type Envio = {
  id: number; version: string; alcance: 'prueba' | 'equipo'; personas: number; correos: number;
  created_at: string; enviado_por_nombre: string | null;
};

export async function traerNovedades(): Promise<Novedades | null> {
  const r = await client.get('/novedades');
  return r?.success ? r.data : null;
}

export async function traerEnvios(version: string): Promise<Envio[]> {
  const r = await client.get(`/novedades/${version}/envios`);
  return r?.success ? (r.data || []) : [];
}

/** El PDF, como descarga. */
export async function bajarPdf(version: string, crm: string) {
  const blob = (await client.get(`/novedades/${version}/pdf`, { responseType: 'blob' })) as unknown as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `novedades-${crm.toLowerCase().replace(/\s+/g, '-')}-${version}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Soltarlo enseguida puede cortar la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function enviarNovedades(version: string, body: { alcance: 'prueba' | 'equipo'; correo?: string | null }) {
  const r = await client.post(`/novedades/${version}/enviar`, body);
  return r?.data;
}
