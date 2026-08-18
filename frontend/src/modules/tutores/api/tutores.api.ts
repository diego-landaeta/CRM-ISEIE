import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export interface Tutor {
  id: number;
  nombre: string;
  email: string;
  active: boolean;
  last_login_at: string | null;
  pendiente_de_entrar: boolean;
  dni_nif: string | null;
  iban: string | null;
  telefono: string | null;
  notas: string | null;
  formaciones: number;
  /** En cuantas marcas da clase. Solo el MultiCRM tiene mas de una. */
  proyectos: number;
  /** Los nombres de sus marcas, separados por punto medio. */
  marcas: string | null;
  /** Si es de la marca elegida arriba o de una hermana de la misma sociedad. */
  es_de_este_proyecto: boolean;
}

export interface Colaboracion {
  id: number;
  tutor_id: number;
  product_id: number;
  pct: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  activa: boolean;
  notas: string | null;
  tutor: string;
  formacion: string;
  precio: string;
  project_id: number;
  proyecto: string;
  /** Marcada activa Y con las fechas de hoy dentro. Son dos cosas distintas. */
  rige_hoy: boolean;
}

export interface LineaSimulacion {
  tutor_id: number;
  tutor: string;
  product_id: number;
  formacion: string;
  /** De que marca es el curso: un profesor puede dar clase en varias. */
  project_id: number;
  proyecto: string;
  pct: string;
  pagos: number;
  base: string;
  comision: string;
}

export interface AjustesTutores {
  aplica_desde: string;
  pct_por_defecto: string;
  updated_at: string;
}


/** Una comision ya creada: esto YA es dinero, no una simulacion. */
export interface ComisionReal {
  id: number;
  periodo: string;
  estado: 'pendiente' | 'pagada' | 'revertida';
  base_calculo: string;
  pct: string;
  importe: string;
  fecha_liquidacion: string | null;
  tutor_id: number;
  tutor: string;
  product_id: number | null;
  formacion: string | null;
  project_id: number | null;
  proyecto: string | null;
  fecha_cobro: string | null;
  cobro: string | null;
  alumno: string;
  liquidada_por_nombre: string | null;
}

export interface ResumenComision {
  periodo: string;
  tutor_id: number;
  tutor: string;
  lineas: number;
  base: string;
  pendiente: string;
  pagada: string;
  revertida: string;
  ultima_liquidacion: string | null;
}

export interface PagoSinFormacion {
  id: number;
  fecha: string;
  importe: string;
  venta: number;
  alumno: string;
  dice: string;
  proyecto: string | null;
}


/** La ficha del curso tal como se publica. Solo lectura para el profesor. */
export interface CursoFicha {
  id: number;
  nombre: string;
  precio: string;
  project_id: number;
  proyecto: string | null;
  fecha_inicio_texto: string | null;
  presentacion_texto: string | null;
  objetivos_texto: string | null;
  beneficios_texto: string | null;
  dirigido_a_texto: string | null;
  para_que_te_prepara_texto: string | null;
  por_que_estudiar_texto: string | null;
  modulos_texto: string | null;
  metodologia_texto: string | null;
  faqs_texto: string | null;
  /** El PDF vigente del curso, si lo hay. El enlace se pide aparte. */
  brochure: { id: number; filename_original: string; version: number; size_bytes: number | null } | null;
}

export const tutoresApi = {
  listar: (projectId?: number | null) =>
    client.get(`/tutores${projectId ? `?projectId=${projectId}` : ''}`) as Promise<ApiResponse<Tutor[]>>,

  alta: (datos: {
    nombre: string; email: string; projectIds: number[];
    dniNif?: string; iban?: string; telefono?: string; notas?: string;
    /** Si viene, el tutor entra ya. Si no, se le manda el correo de Brevo. */
    password?: string;
  }) => client.post('/tutores', datos) as Promise<ApiResponse<Tutor & { entraYa?: boolean }>>,

  guardarPerfil: (id: number, datos: Record<string, string | null>) =>
    client.patch(`/tutores/${id}/perfil`, datos) as Promise<ApiResponse<unknown>>,

  colaboraciones: (tutorId?: number | null) =>
    client.get(`/tutores/colaboraciones${tutorId ? `?tutorId=${tutorId}` : ''}`) as Promise<ApiResponse<Colaboracion[]>>,

  crearColaboracion: (datos: {
    tutorId: number; productId: number; pct: number; desde: string; hasta?: string | null; notas?: string;
  }) => client.post('/tutores/colaboraciones', datos) as Promise<ApiResponse<Colaboracion>>,

  editarColaboracion: (id: number, datos: Record<string, unknown>) =>
    client.patch(`/tutores/colaboraciones/${id}`, datos) as Promise<ApiResponse<Colaboracion>>,

  borrarColaboracion: (id: number) =>
    client.delete(`/tutores/colaboraciones/${id}`) as Promise<ApiResponse<{ borrada: boolean; desactivada: boolean; comisiones: number }>>,

  ajustes: () => client.get('/tutores/ajustes') as Promise<ApiResponse<AjustesTutores>>,
  guardarAjustes: (datos: { aplicaDesde?: string; pctPorDefecto?: number }) =>
    client.patch('/tutores/ajustes', datos) as Promise<ApiResponse<AjustesTutores>>,

  /** Lo que se pagaria si el calculo estuviera encendido. No crea nada. */
  simulacion: (desde: string, hasta: string, tutorId?: number | null, projectId?: number | null) =>
    client.get(`/tutores/simulacion?desde=${desde}&hasta=${hasta}`
      + `${tutorId ? `&tutorId=${tutorId}` : ''}${projectId ? `&projectId=${projectId}` : ''}`) as Promise<ApiResponse<LineaSimulacion[]>>,

  /** Crea las comisiones que falten. Pulsarlo dos veces no duplica nada. */
  calcularComisiones: (datos: { desde?: string | null; hasta?: string | null; projectId?: number | null }) =>
    client.post('/tutores/comisiones/calcular', datos) as Promise<ApiResponse<{
      creadas: number; importe: number; tutores: number; periodos: string[];
    }>>,

  comisiones: (q: { periodo?: string | null; tutorId?: number | null; estado?: string | null; projectId?: number | null }) =>
    client.get('/tutores/comisiones?' + new URLSearchParams(
      Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
    ).toString()) as Promise<ApiResponse<ComisionReal[]>>,

  resumenComisiones: (q: { periodo?: string | null; tutorId?: number | null; projectId?: number | null }) =>
    client.get('/tutores/comisiones/resumen?' + new URLSearchParams(
      Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
    ).toString()) as Promise<ApiResponse<ResumenComision[]>>,

  /** Marcar como pagadas. Solo un administrador. */
  liquidar: (datos: { ids?: number[]; periodo?: string; tutorId?: number }) =>
    client.post('/tutores/comisiones/liquidar', datos) as Promise<ApiResponse<{ liquidadas: number; importe: number }>>,

  revertirComision: (id: number, motivo: string) =>
    client.post(`/tutores/comisiones/${id}/revertir`, { motivo }) as Promise<ApiResponse<ComisionReal>>,

  pagosSinFormacion: (desde: string, hasta: string, projectId?: number | null) =>
    client.get(`/tutores/pagos-sin-formacion?desde=${desde}&hasta=${hasta}`
      + (projectId ? `&projectId=${projectId}` : '')) as Promise<ApiResponse<PagoSinFormacion[]>>,

  /** La ficha del curso que imparte. El servidor comprueba que sea suyo. */
  curso: (productId: number) =>
    client.get(`/tutores/curso/${productId}`) as Promise<ApiResponse<CursoFicha>>,

  /** Enlace temporal al brochure. Caduca: no es una direccion permanente. */
  brochureDelCurso: (productId: number) =>
    client.get(`/tutores/curso/${productId}/brochure`) as Promise<ApiResponse<{
      url: string; filename: string; version: number;
    }>>,
};
