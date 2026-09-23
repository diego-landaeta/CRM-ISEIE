import client from '@/shared/api/client';

/*
  La agenda del proceso comercial (#89 · #90).

  El recorte de quién ve qué lo hace el servidor: una gestora solo recibe lo
  suyo aunque escriba el id de otra. Aquí no se esconde nada.
*/

export type PasoEnCola = {
  lead_id: number;
  lead_nombre: string | null;
  lead_estado: string;
  /** Para rellenar los huecos del mensaje sin salir de la cola (#88). */
  lead_email?: string | null;
  lead_telefono?: string | null;
  responsable_id: number | null;
  gestora: string | null;
  clave: string;
  orden: number;
  paso_nombre: string | null;
  canales: string[] | null;
  paso_nota: string | null;
  fecha_prevista: string;
  dias_de_retraso: number;
  contactos: number;
  /** La formación por la que preguntó. Las plazas NO vienen: no las lleva el
      CRM, se miran en el sistema de admisiones. Solo viene la marca de que
      este paso las menciona y hay que ir a comprobarlas. */
  producto: string | null;
  producto_precio: string | number | null;
  /** Cuándo empieza y cuándo cierra, tal como los lleva el catálogo. */
  fecha_inicio_texto?: string | null;
  fecha_cierre_convocatoria?: string | null;
  avisa_plazas: boolean;
  /** El campus. Solo importa cuando se mira una empresa entera. */
  project_id: number;
  proyecto: string | null;
};

/**
 * Alguien del repaso de fin de mes.
 *
 * Trae lo mismo que una fila de la cola --para poder abrir la misma ventana--
 * mas lo suyo: cuanto hace que entro y cuanto lleva sin noticias.
 */
export type EnSeguimiento = Omit<PasoEnCola, 'fecha_prevista' | 'dias_de_retraso'> & {
  fecha_entrada: string;
  dias_desde_entrada: number;
  /** null = no se le ha contactado NUNCA. */
  ultimo_contacto: string | null;
  dias_sin_contacto: number | null;
  antiguedad: 'este_mes' | 'uno_a_tres' | 'tres_a_seis' | 'mas_de_seis';
};

export type ResumenSeguimiento = {
  total: number;
  este_mes: number;
  uno_a_tres: number;
  tres_a_seis: number;
  mas_de_seis: number;
  nunca_contactados: number;
};

export type ResumenCola = {
  atrasados: number;
  hoy: number;
  manana: number;
  esta_semana: number;
};

export type PasoDeLead = {
  id: number;
  clave: string;
  orden: number;
  nombre: string | null;
  cuando: string | null;
  canales: string[] | null;
  nota_del_paso: string | null;
  fecha_prevista: string;
  estado: 'pendiente' | 'saltado';
  nota: string | null;
  hecho: boolean;
  vencido: boolean;
  dias_de_retraso: number;
  /** Su mensaje dice cuántas plazas quedan: hay que comprobarlo fuera. */
  avisa_plazas: boolean;
};

function conAmbito(params: Record<string, string | number | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // `-1` es «todos los proyectos», un valor interno del CRM: mandarlo pediría
    // el proyecto número menos uno.
    if (v === undefined || v === null || v === '' || v === -1) continue;
    q.set(k, String(v));
  }
  return q.toString();
}

export async function traerCola(opciones: {
  projectId?: number | null; projectIds?: string | null; gestoraId?: number | null; hasta?: string | null; limite?: number;
}): Promise<PasoEnCola[]> {
  const r = await client.get(`/proceso/cola?${conAmbito(opciones)}`);
  return r?.success ? r.data : [];
}

export async function traerResumen(opciones: {
  projectId?: number | null; projectIds?: string | null; gestoraId?: number | null;
}): Promise<ResumenCola | null> {
  const r = await client.get(`/proceso/cola/resumen?${conAmbito(opciones)}`);
  return r?.success ? r.data : null;
}

/** La base que toca repasar a fin de mes. */
export async function traerSeguimiento(opciones: {
  projectId?: number | null; projectIds?: string | null; gestoraId?: number | null; limite?: number;
}): Promise<EnSeguimiento[]> {
  const r = await client.get(`/proceso/seguimiento?${conAmbito(opciones)}`);
  return r?.success ? r.data : [];
}

/** Cuantos son de verdad, sin el tope de la lista. */
export async function traerResumenSeguimiento(opciones: {
  projectId?: number | null; projectIds?: string | null; gestoraId?: number | null;
}): Promise<ResumenSeguimiento | null> {
  const r = await client.get(`/proceso/seguimiento/resumen?${conAmbito(opciones)}`);
  return r?.success ? r.data : null;
}

export async function traerPasosDeLead(leadId: number): Promise<PasoDeLead[]> {
  const r = await client.get(`/proceso/lead/${leadId}`);
  return r?.success ? r.data : [];
}

export async function ajustarPaso(id: number, datos: {
  estado?: 'pendiente' | 'saltado'; fecha_prevista?: string; nota?: string;
}) {
  const r = await client.patch(`/proceso/paso-lead/${id}`, datos);
  return r?.success ? r.data : null;
}

export async function replanificar(leadId: number) {
  const r = await client.post(`/proceso/lead/${leadId}/replanificar`, {});
  return r?.success ? r.data : null;
}
