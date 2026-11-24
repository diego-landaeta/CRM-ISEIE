import client, { API_BASE_URL, getAccessToken, setAccessToken } from '@/shared/api/client';
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
  banco: string | null;
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
  /** Lo que ha entregado de esta formacion. Marcas, no archivos. */
  entrego_foto: boolean;
  entrego_video: boolean;
  /** 0, 25, 50 o 100. */
  modulos_pct: number;
}

/** Lo que contesta «Cobra desde»: que formaciones se movieron y cuales no. */
export interface ResultadoCobraDesde {
  desde: string;
  /** Colaboraciones activas que tenia. */
  total: number;
  cambiadas: Array<{ id: number; formacion: string; antes: string; desde: string }>;
  /** Las que no se movieron, con el motivo: solaparian con otro tramo suyo de
   *  esa formacion, o terminarian antes de empezar. */
  noCambiadas: Array<{ id: number; formacion: string; desde: string; hasta: string | null; motivo: string }>;
  /** Las que ya tenian esa fecha. */
  sinCambio: number;
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
  /** Si el CRM escribe a los tutores. Con el freno puesto (15/09), no. */
  correos_a_tutores?: boolean;
}


/** Una comision ya creada: esto YA es dinero, no una simulacion. */
export interface ComisionReal {
  id: number;
  periodo: string;
  /** `notificada` = ya se le pidio la factura. `falta_factura` = se le pidio y
   *  no la ha mandado, que es distinto de que nadie le haya dicho nada. */
  estado: 'pendiente' | 'notificada' | 'falta_factura' | 'pagada' | 'revertida';
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
  /** Lo entregado de esa formacion, para no pagar a ciegas. */
  entrego_foto?: boolean | null;
  entrego_video?: boolean | null;
  modulos_pct?: number | null;
}

export interface ResumenComision {
  periodo: string;
  tutor_id: number;
  tutor: string;
  /** El correo y la cuenta salen en la fila: son lo que hace falta para pagar.
      Los devuelve la consulta del resumen (tutor.model.js:376) y no estaban
      declarados aqui, asi que la pantalla los pintaba a ciegas. */
  tutor_email: string | null;
  tutor_iban: string | null;
  lineas: number;
  base: string;
  pendiente: string;
  pagada: string;
  revertida: string;
  ultima_liquidacion: string | null;
}

export interface FormacionSinTutor {
  /** Su venta más reciente es anterior al corte de comisiones. */
  antes_del_corte?: boolean;
  ultima_venta?: string | null;
  corte?: string | null;
  id: number;
  nombre: string;
  precio: string | null;
  proyecto: string | null;
  project_id: number;
  ventas: number;
  alumnos: number;
  pagos: number;
  cobrado: string;
  primer_cobro: string | null;
  ultimo_cobro: string | null;
  /* Si se esta buscando tutor, y con que anuncio de Meta. Lo marca una persona:
     Meta no sabe a que formacion del catalogo apunta cada conjunto de anuncios. */
  buscando: boolean;
  busqueda_nota: string | null;
  busqueda_desde: string | null;
  anuncio_id: string | null;
  anuncio_nombre: string | null;
  /** Tal cual lo dice Meta: ACTIVE, PAUSED... */
  anuncio_estado: string | null;
  anuncio_gasto: string | null;
  anuncio_leads: number | null;
  /** Se apunto un anuncio y en Meta ya no esta. */
  anuncio_desaparecido: boolean;
}

/** Un conjunto de anuncios de Meta, para engancharlo a una formacion. */
export interface AnuncioMeta {
  adset_id: string;
  nombre: string;
  status: string | null;
  total_spend: string | null;
  total_leads: number | null;
  project_id: number;
  campaign_id: string;
  campana: string;
  campana_estado: string | null;
  /** Se llama como si buscara tutores. Solo ordena la lista, no decide nada. */
  parece_de_tutores: boolean;
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

// «Mi campus» (#408, gemela de CRM#681): lo que devuelve GET /tutores/mi-campus.
export interface MiCampusAlumno {
  id: number; nombre: string | null; email: string | null; ultimoAcceso: string | null; mensajeUrl: string;
  /** % del curso hecho según Moodle; null = sin seguimiento o sin dato: «—», no 0 %. */
  progreso?: number | null;
}
export interface MiCampusDuda { consultaId: number; alumnoId: number | null; alumno: string | null; desde: string | null }
/**
 * Un mensaje privado de Moodle que espera su respuesta (el último es del alumno), de
 * cualquier fecha: también los de antes de conectar el campus. Se contesta en Moodle.
 */
export interface MiCampusMensaje {
  conversacionId: number; alumnoId: number; alumno: string | null; desde: string | null; responderUrl: string;
}
export interface MiCampusTarea {
  id: number; nombre: string | null; entrega: string | null;
  /** La tarea en el calificador de Moodle (para lo que no se corrige desde el CRM). */
  corregirUrl: string;
  sinCorregir: Array<{ alumnoId: number; alumno: string | null; entregadaAt: string | null; corregirUrl?: string }>;
  notaMax?: number;
  enGrupo?: boolean;
}
export interface MiCampusCurso {
  id: number; nombre: string | null; url: string; error: string | null;
  /** ¿Tiene activado el seguimiento de finalización en Moodle? Sin él, el % de todos es «—». */
  seguimiento?: boolean;
  /** Por qué no se ha leído el % de sus alumnos (demasiados, o Moodle no contesta). */
  avisoProgreso?: string | null;
  alumnos: MiCampusAlumno[]; dudas: MiCampusDuda[]; tareas: MiCampusTarea[];
  /** Sus mensajes de Moodle sin responder de alumnos de este curso. */
  sinResponder?: MiCampusMensaje[];
}
export interface MiCampusCampus {
  projectId: number; campus: string; url: string | null; error: string | null;
  cursos: MiCampusCurso[]; dudasSinCurso: MiCampusDuda[];
  /** Lo que dijo la última comprobación de su cuenta (p. ej. que el correo apunta a otra). */
  aviso?: string | null;
  /** Mensajes sin responder de alguien que no está en sus cursos. */
  sinResponderSinCurso?: MiCampusMensaje[];
  /** Por qué no se han podido leer sus mensajes de Moodle. */
  avisoMensajes?: string | null;
}
export interface MiCampusPendiente {
  id: number; nombre: string; tipo: string; estado: string; campus: string; fechaComprometida: string | null;
  projectId?: number | null;
  avance: { foto: boolean; video: boolean; modulos: number };
}
// Corregir desde el CRM (#408, gemela de CRM#681).
export type EstadoEntrega = 'sin_corregir' | 'calificada' | 'sin_entregar';
export interface ArchivoEntregado { nombre: string; tamano: number | null; tipo: string | null }
/** Lo que se abre en otra pestaña; el resto de lo que entrega un alumno, se descarga. */
export const TIPOS_EN_LINEA = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
export interface EntregaDeTarea {
  alumnoId: number; alumno: string | null; email: string | null; estado: EstadoEntrega;
  entregadaAt: string | null; texto: string; archivos: ArchivoEntregado[]; nota: number | null;
  /** El último mensaje del chat con el alumno (Consultas), o null si no han hablado. */
  ultimoMensaje: { consultaId: number; texto: string; at: string; deTutora: boolean } | null;
}
export interface TareaParaCorregir {
  tarea: {
    id: number; nombre: string | null; notaMax: number; entrega: string | null; enunciado: string; moodleUrl: string; comentarios: boolean;
    /** Con escala o sin nota, o en grupo: se corrige en Moodle, no aquí. */
    calificable: boolean; enGrupo: boolean;
  };
  entregas: EntregaDeTarea[];
}

/** El curso entero (#408, gemela de CRM#681): sus temas y todas sus actividades, como en Moodle. */
export interface ActividadDelCurso {
  cmid: number; instancia: number | null; tipo: string | null; nombre: string | null; url: string | null;
  visible: boolean; restringida: boolean; fechas: { etiqueta: string | null; at: string }[];
  /** Solo en las tareas: lo que tiene por corregir y si se corrige aquí o en Moodle. */
  tarea: { id: number; porCorregir: number; corregibleEnElCrm: boolean } | null;
}
export interface SeccionDelCurso { id: number; numero: number; nombre: string | null; visible: boolean; actividades: ActividadDelCurso[] }
export interface CursoCompleto { curso: { id: number; nombre: string | null; url: string; alumnos: number }; secciones: SeccionDelCurso[] }

export interface MiCampusSinConectar { projectId: number; campus: string; estado: string | null; motivo: string }
export interface MiCampus {
  leidoAt: string; campus: MiCampusCampus[]; pendientes: MiCampusPendiente[]; sinConectar?: MiCampusSinConectar[];
  /** Todos sus campus conectados, también los que no se han elegido (el selector de Mi campus). */
  todosLosCampus?: Array<{ projectId: number; campus: string }>;
  /** Los campus que se han leído si se pidieron unos en concreto; null = todos. */
  elegidos?: number[] | null;
}

export const tutoresApi = {
  verCurso: (projectId: number, cursoId: number) =>
    client.get(`/tutores/mi-campus/cursos/${projectId}/${cursoId}`) as Promise<ApiResponse<CursoCompleto>>,
  verTarea: (projectId: number, cursoId: number, tareaId: number) =>
    client.get(`/tutores/mi-campus/tareas/${projectId}/${cursoId}/${tareaId}`) as Promise<ApiResponse<TareaParaCorregir>>,
  calificar: (projectId: number, cursoId: number, tareaId: number, datos: { alumnoId: number; nota: number; comentario: string }) =>
    client.post(`/tutores/mi-campus/tareas/${projectId}/${cursoId}/${tareaId}/calificar`, datos) as Promise<ApiResponse<{ nota: number; maxima: number; comentario: boolean }>>,
  /**
   * Abre un archivo entregado: lo sirve el CRM (el token del campus no sale del servidor).
   * Solo PDF, imágenes y texto se abren en otra pestaña; el resto se descarga. Un blob abierto
   * hereda el origen del CRM, así que un HTML o un SVG de un alumno jamás se abre en línea.
   */
  async abrirArchivo(projectId: number, cursoId: number, tareaId: number, alumnoId: number, n: number, nombre: string) {
    const ventana = window.open('', '_blank');
    try {
      const pedir = () => fetch(`${API_BASE_URL}/tutores/mi-campus/tareas/${projectId}/${cursoId}/${tareaId}/archivo?alumnoId=${alumnoId}&n=${n}`, {
        headers: { Authorization: `Bearer ${getAccessToken() || ''}` }, credentials: 'include',
      });
      let r = await pedir();
      if (r.status === 401) {
        const renovada = await fetch(`${API_BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
        if (renovada.ok) { setAccessToken((await renovada.json()).data.accessToken); r = await pedir(); }
      }
      if (!r.ok) {
        const cuerpo = await r.json().catch(() => null);
        throw new Error(cuerpo?.error || 'No se ha podido abrir el archivo.');
      }
      const tipo = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const enLinea = TIPOS_EN_LINEA.has(tipo);
      const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type: enLinea ? tipo : 'application/octet-stream' }));
      if (enLinea && ventana) {
        ventana.opener = null;
        ventana.location.href = url;
      } else {
        ventana?.close();
        const a = document.createElement('a');
        a.href = url; a.download = nombre || 'archivo'; a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { ventana?.close(); throw err; }
  },
  /** «Mi campus» de quien pide (el servidor usa su sesión). Con `refrescar`, sin la copia de 2 min. */
  /** Con `campus`, solo esos campus suyos (el servidor no lee de Moodle los demás). Vacío = todos. */
  miCampus: (refrescar = false, campus: number[] = []) => {
    const q = new URLSearchParams();
    if (refrescar) q.set('refrescar', '1');
    if (campus.length) q.set('campus', campus.join(','));
    const s = q.toString();
    return client.get(`/tutores/mi-campus${s ? `?${s}` : ''}`) as Promise<ApiResponse<MiCampus>>;
  },
  /** Por defecto solo los que dan clase hoy. Con `incluirRetirados` salen
   *  tambien los que se dieron de baja — es la unica forma de volver a
   *  activar a alguien, porque retirado desaparece de la lista. */
  listar: (projectId?: number | null, incluirRetirados = false) => {
    const q = new URLSearchParams();
    if (projectId) q.set('projectId', String(projectId));
    if (incluirRetirados) q.set('activos', '0');
    const cola = q.toString();
    return client.get(`/tutores${cola ? `?${cola}` : ''}`) as Promise<ApiResponse<Tutor[]>>;
  },

  alta: (datos: {
    nombre: string; email: string; projectIds: number[];
    dniNif?: string; iban?: string; telefono?: string; notas?: string;
    /** Si viene, el tutor entra ya. Si no, se le manda el correo de Brevo. */
    password?: string;
  }) => client.post('/tutores', datos) as Promise<ApiResponse<Tutor & { entraYa?: boolean }>>,

  // Ademas del perfil acepta `email` —que es la credencial— y
  // `reenviarEnlace`, para mandarle el enlace de contraseña a la nueva.
  guardarPerfil: (id: number, datos: Record<string, string | boolean | null | undefined>) =>
    client.patch(`/tutores/${id}/perfil`, datos) as Promise<ApiResponse<unknown>>,

  colaboraciones: (tutorId?: number | null) =>
    client.get(`/tutores/colaboraciones${tutorId ? `?tutorId=${tutorId}` : ''}`) as Promise<ApiResponse<Colaboracion[]>>,

  /** Con `anadirAlCampus`, si la formación es de un campus en el que el tutor no
   *  está, se le da de alta ahí en el mismo paso (#223). Sin él, ese caso es un
   *  409 `OTRO_PROYECTO` con el campus en `data`. */
  crearColaboracion: (datos: {
    tutorId: number; productId: number; pct: number; desde: string; hasta?: string | null; notas?: string;
    anadirAlCampus?: boolean;
  }) => client.post('/tutores/colaboraciones', datos) as Promise<ApiResponse<Colaboracion & {
    campusAnadido?: { projectId: number; proyecto: string | null };
  }>>,

  /** Mover una comision entre pendiente, notificada y falta_factura. Pagar y
   *  revertir NO pasan por aqui: tienen su propia llamada porque mueven dinero. */
  cambiarEstadoComision: (id: number, estado: string) =>
    client.patch(`/tutores/comisiones/${id}/estado`, { estado }) as Promise<ApiResponse<ComisionReal>>,

  editarColaboracion: (id: number, datos: Record<string, unknown>) =>
    client.patch(`/tutores/colaboraciones/${id}`, datos) as Promise<ApiResponse<Colaboracion>>,

  /** «Cobra desde» (Diego, 13/10): la misma fecha de inicio para TODAS sus
   *  colaboraciones activas. No genera comisiones: eso es «Calcular». */
  cambiarCobraDesde: (tutorId: number, desde: string) =>
    client.patch(`/tutores/${tutorId}/cobra-desde`, { desde }) as Promise<ApiResponse<ResultadoCobraDesde>>,

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
  calcularComisiones: (datos: {
    desde?: string | null; hasta?: string | null; projectId?: number | null;
    /** Los campus de la empresa, para calcularlos todos de una vez. */
    projectIds?: number[] | null;
  }) =>
    client.post('/tutores/comisiones/calcular', datos) as Promise<ApiResponse<{
      creadas: number; importe: number; tutores: number; periodos: string[];
    }>>,

  comisiones: (q: {
    periodo?: string | null; tutorId?: number | null; estado?: string | null;
    projectId?: number | null; issuerId?: number | null;
  }) =>
    client.get('/tutores/comisiones?' + new URLSearchParams(
      Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
    ).toString()) as Promise<ApiResponse<ComisionReal[]>>,

  // `issuerId` manda sobre `projectId`: el servidor lo traduce a los campus
  // de esa empresa, igual que en Ventas y en Reportes.
  resumenComisiones: (q: {
    periodo?: string | null; tutorId?: number | null;
    projectId?: number | null; issuerId?: number | null;
  }) =>
    client.get('/tutores/comisiones/resumen?' + new URLSearchParams(
      Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])
    ).toString()) as Promise<ApiResponse<ResumenComision[]>>,

  /** Marcar como pagadas. Solo un administrador. */
  liquidar: (datos: { ids?: number[]; periodo?: string; tutorId?: number }) =>
    client.post('/tutores/comisiones/liquidar', datos) as Promise<ApiResponse<{ liquidadas: number; importe: number }>>,

  revertirComision: (id: number, motivo: string) =>
    client.post(`/tutores/comisiones/${id}/revertir`, { motivo }) as Promise<ApiResponse<ComisionReal>>,

  // Las que ya venden y no tienen a quien pagarle.
  formacionesSinTutor: (projectId?: number | null, todas = false) => {
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', String(projectId));
    // Con `todas` salen tambien las ventas anteriores al corte de comisiones.
    if (todas) p.set('todas', '1');
    const q = p.toString();
    return client.get('/tutores/formaciones-sin-tutor' + (q ? `?${q}` : '')) as Promise<ApiResponse<FormacionSinTutor[]>>;
  },

  /** «Se busca tutor para esta formacion», y con que anuncio si lo hay. */
  marcarBusquedaTutor: (productId: number, datos: {
    buscando: boolean; adsetId?: string | null; campaignId?: string | null; nota?: string | null;
  }) => client.put(`/tutores/formaciones/${productId}/busqueda`, datos) as Promise<ApiResponse<{
    id: number; product_id: number; buscando: boolean; adset_id: string | null;
  }>>,

  /** Los anuncios de Meta del ambito, para elegir uno. */
  anunciosDeTutores: (projectId?: number | null) =>
    client.get('/tutores/anuncios' + (projectId ? `?projectId=${projectId}` : '')) as
      Promise<ApiResponse<AnuncioMeta[]>>,

  pagosSinFormacion: (desde: string, hasta: string, projectId?: number | null, issuerId?: number | null) =>
    client.get(`/tutores/pagos-sin-formacion?desde=${desde}&hasta=${hasta}`
      + (projectId ? `&projectId=${projectId}` : '')
      + (issuerId ? `&issuerId=${issuerId}` : '')) as Promise<ApiResponse<PagoSinFormacion[]>>,

  /** La ficha del curso que imparte. El servidor comprueba que sea suyo. */
  curso: (productId: number) =>
    client.get(`/tutores/curso/${productId}`) as Promise<ApiResponse<CursoFicha>>,

  /** Enlace temporal al brochure. Caduca: no es una direccion permanente. */
  brochureDelCurso: (productId: number) =>
    client.get(`/tutores/curso/${productId}/brochure`) as Promise<ApiResponse<{
      url: string; filename: string; version: number;
    }>>,
  /** Le pone otra contraseña. Solo vale sobre TUTORES: el servidor rechaza
   *  cualquier otro rol aunque se pruebe con su identificador. */
  // Solo el super admin, repetida y con las reglas de «Establece tu contraseña» (#248).
  cambiarContrasena: (id: number, password: string, confirmPassword: string) =>
    client.post(`/tutores/${id}/contrasena`, { password, confirmPassword }) as Promise<ApiResponse<{
      id: number; nombre: string; email: string;
    }>>,

  /** Retirar a un profesor. NO lo borra —sus comisiones son dinero devengado y
   *  quedarian colgando— : lo desactiva y cierra sus cursos hoy. Devuelve lo
   *  que le quede pendiente de pagar, para no retirar a nadie a ciegas. */
  retirar: (id: number) =>
    client.delete(`/tutores/${id}`) as Promise<ApiResponse<{
      id: number; nombre: string; email: string;
      cursosCerrados: number; pendienteDePagar: number;
    }>>,

  /** Volver a darle de alta. Los cursos hay que reabrirlos a mano: cerrarlos
   *  fue una decision con fecha y no se deshace sola. */
  reactivar: (id: number) =>
    client.post(`/tutores/${id}/reactivar`, {}) as Promise<ApiResponse<{
      id: number; nombre: string; email: string;
    }>>,
};
