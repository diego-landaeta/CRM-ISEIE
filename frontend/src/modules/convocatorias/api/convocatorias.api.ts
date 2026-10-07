import client from '@/shared/api/client';

/*
  Convocatorias y ofrecimientos (#86).

  Dos cosas distintas con nombres parecidos:

    la CONVOCATORIA  es la campaña —CETLAT, y las que vengan—. La crea la casa.
    el OFRECIMIENTO  es lo que le pasó a UNA persona con ella. Lo lleva la
                     gestora: cuándo se la ofreció, qué le prometió, cuánto
                     descuento le dio.

  EL DESCUENTO NO ESTÁ EN LA CAMPAÑA. Diego: «son aleatorias porque el proceso
  de venta decide cuánto dar». Lo que la campaña aporta no es el número, es la
  excusa y el reloj; el porcentaje vive en el ofrecimiento.

  «SI COMPRÓ» NO SE GUARDA. Viene deducido de sus ventas posteriores al
  ofrecimiento, igual que los pasos del proceso. Aquí no se vuelve a calcular.
*/

export type Convocatoria = {
  id: number;
  project_id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
  /** Los topes de descuento, en porcentaje. CETLAT viene con 40 y 70. */
  tope_nueva: number;
  tope_habilitada: number;
  nota_interna: string | null;
  /** Cuántas veces se ha ofrecido. Solo lo trae el listado. */
  ofrecimientos?: number;
};

export type ResultadoOfrecimiento = 'pendiente' | 'concedida' | 'denegada' | 'caducada';

export type Ofrecimiento = {
  id: number;
  convocatoria_id: number;
  lead_id: number;
  project_id: number;
  ofrecida_at: string;
  ofrecida_por: number | null;
  canal: string | null;
  /** Hasta cuándo puede pedirla. Caduca la ventana de ESTA persona, no la campaña. */
  fecha_limite: string | null;
  /** Cuándo le dijimos que le contestamos. */
  fecha_resultado: string | null;
  /** `null` es «todavía no se ha preguntado», y es un estado de verdad. */
  solicitud_llenada: boolean | null;
  solicitud_at: string | null;
  descuento: number | string | null;
  resultado: ResultadoOfrecimiento;
  nota: string | null;
  /** Solo en la ficha del prospecto. */
  convocatoria?: string;
  tope_nueva?: number;
  tope_habilitada?: number;
  ofrecida_por_nombre?: string | null;
  compro?: boolean;
  debe_respuesta?: boolean;
  /**
   * El aviso de que el descuento pasa del tope. LO ESCRIBE EL SERVIDOR y llega
   * al guardar: aquí no se rehace. El CRM no sabe si una formación está «ya
   * habilitada», así que avisa contra el tope bajo y nombra los dos en vez de
   * decidir por su cuenta. No bloquea — bloquear un descuento autorizado a mano
   * lleva a no registrarlo, que es perder el dato.
   */
  aviso?: string | null;
};

export type Pendiente = Ofrecimiento & {
  convocatoria: string;
  lead_nombre: string | null;
  gestora: string | null;
  dias_de_retraso: number;
};

export type Embudo = {
  ofrecidas: number;
  llenaron: number;
  no_llenaron: number;
  /** Ni sí ni no: todavía no se ha preguntado. Contarlo como «no» haría que el
      embudo pareciera peor de lo que es y esconde el trabajo que falta. */
  sin_saber: number;
  con_descuento: number;
  descuento_medio: number | null;
  descuento_maximo: number | null;
  compraron: number;
  deben_respuesta: number;
  pct_llenaron: number;
  pct_compraron: number;
  /** De los que llenaron la solicitud, cuántos compraron. Es la cifra que dice
      si la beca cierra ventas o solo entretiene. */
  pct_compraron_de_los_que_llenaron: number;
};

function consulta(params: Record<string, string | number | undefined | null>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    // `-1` es «todos los proyectos», un valor interno del CRM: mandarlo pediría
    // el proyecto número menos uno.
    if (v === undefined || v === null || v === '' || v === -1) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export async function traerConvocatorias(opciones: {
  projectId?: number | null; incluirInactivas?: boolean;
} = {}): Promise<Convocatoria[]> {
  const r = await client.get(`/convocatorias${consulta({
    projectId: opciones.projectId,
    incluirInactivas: opciones.incluirInactivas ? 'true' : undefined,
  })}`);
  return r?.success ? r.data : [];
}

export async function crearConvocatoria(datos: {
  nombre: string; descripcion?: string; tope_nueva?: number; tope_habilitada?: number; nota_interna?: string;
}, projectId?: number | null): Promise<Convocatoria | null> {
  const r = await client.post(`/convocatorias${consulta({ projectId })}`, datos);
  return r?.success ? r.data : null;
}

export async function editarConvocatoria(
  id: number,
  datos: Partial<{ nombre: string; descripcion: string; activa: boolean; tope_nueva: number; tope_habilitada: number; nota_interna: string }>,
  projectId?: number | null,
): Promise<Convocatoria | null> {
  const r = await client.patch(`/convocatorias/${id}${consulta({ projectId })}`, datos);
  return r?.success ? r.data : null;
}

export async function traerOfrecimientosDeLead(leadId: number): Promise<Ofrecimiento[]> {
  const r = await client.get(`/convocatorias/lead/${leadId}`);
  return r?.success ? r.data : [];
}

export async function ofrecer(convocatoriaId: number, datos: {
  leadId: number; canal?: string; fecha_limite?: string; fecha_resultado?: string; nota?: string;
}): Promise<Ofrecimiento | null> {
  const r = await client.post(`/convocatorias/${convocatoriaId}/ofrecer`, datos);
  return r?.success ? r.data : null;
}

export async function actualizarOfrecimiento(id: number, datos: Partial<{
  solicitud_llenada: boolean; descuento: number; resultado: ResultadoOfrecimiento;
  fecha_limite: string; fecha_resultado: string; nota: string;
}>): Promise<Ofrecimiento | null> {
  const r = await client.patch(`/convocatorias/ofrecimientos/${id}`, datos);
  return r?.success ? r.data : null;
}

export async function traerPendientes(opciones: {
  projectId?: number | null; gestoraId?: number | null;
} = {}): Promise<Pendiente[]> {
  const r = await client.get(`/convocatorias/pendientes${consulta(opciones)}`);
  return r?.success ? r.data : [];
}

export async function traerEmbudo(opciones: {
  convocatoriaId?: number | null; projectId?: number | null; from?: string | null; to?: string | null;
} = {}): Promise<Embudo | null> {
  const r = await client.get(`/convocatorias/embudo${consulta(opciones)}`);
  return r?.success ? r.data : null;
}
