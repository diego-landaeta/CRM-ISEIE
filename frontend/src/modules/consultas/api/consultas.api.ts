import client, { API_BASE_URL, getAccessToken, setAccessToken } from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

/*
  Consultas de alumnos, fase 2 (#188): la bandeja del tutor y el panel de
  administración. Fase 3 (#189): alumnos sin mensajes, carga de trabajo y
  métricas.
*/

export type EstadoConsulta = 'abierta' | 'respondida' | 'cerrada';

export interface ConsultaFila {
  id: number;
  project_id: number;
  campus: string;
  empresa: string | null;
  alumno_nombre: string | null;
  alumno_email: string | null;
  curso_nombre: string | null;
  tutor_id: number | null;
  tutor: string | null;
  estado: EstadoConsulta;
  entrada_at: string;
  asignada_at: string | null;
  primera_lectura_at: string | null;
  primera_respuesta_at: string | null;
  cerrada_at: string | null;
  reabierta_at: string | null;
  /** Desde cuándo espera respuesta el alumno (solo si está abierta). */
  espera_desde: string | null;
  ultimo_mensaje: string | null;
  /** Respuestas del tutor que aún no han llegado al campus. */
  sin_enviar: number;
}

export interface AdjuntoConsulta { id: number; mensaje_id: number; nombre: string; tipo: string | null; tamano: number | null }

export interface MensajeConsulta {
  id: number;
  autor: 'alumno' | 'tutor';
  autor_nombre: string | null;
  texto: string;
  escrito_at: string;
  enviado_campus_at: string | null;
  error_envio: string | null;
  en_el_campus: boolean;
  adjuntos: AdjuntoConsulta[];
}

export interface EventoConsulta { tipo: string; at: string; quien: string | null; detalle: Record<string, unknown> | null }

export interface ConsultaDetalle extends ConsultaFila {
  mensajes: MensajeConsulta[];
  eventos: EventoConsulta[];
  plazoHoras: number;
  /** 'tutor' = es la suya (responde y cierra) · 'admin' = la ve administración (cierra y reasigna). */
  puedes: 'tutor' | 'admin';
}

export interface ListaConsultas { consultas: ConsultaFila[]; plazoHoras: number }

export interface FiltrosConsultas {
  estado?: 'pendientes' | EstadoConsulta;
  sinTutor?: boolean;
  buscar?: string;
}

// ─── Fase 3 (#189) ──────────────────────────────────────────────────────────

export type Color = 'verde' | 'ambar' | 'rojo';

export interface AlumnoSinMensajes {
  id: number;
  project_id: number;
  campus: string;
  tutor_id: number;
  tutor: string | null;
  alumno_nombre: string | null;
  alumno_email: string | null;
  curso_nombre: string | null;
  matriculado_desde: string;
  /** La fecha es la primera vez que el CRM vio al alumno, no la de Moodle. */
  matricula_aproximada: boolean;
  ultimo_acceso: string | null;
  dias: number;
  color: Color;
}

export type NivelCarga = 'baja' | 'media' | 'alta' | 'completa';
export interface DatosReales { alumnos_activos: number; consultas_abiertas: number; alumnos_sin_mensajes: number }
export interface CargaApunte { id: number; nivel: NivelCarga; texto: string | null; created_at: string; por: string | null }
export interface MiCarga {
  actual: CargaApunte | null;
  historial: CargaApunte[];
  desactualizada: boolean;
  diasPlazo: number;
  datosReales: DatosReales;
}

export interface TutorPanel extends DatosReales {
  id: number;
  nombre: string;
  email: string;
  disponible: boolean;
  motivo_no_disponible: string | null;
  campus: string[];
  empresas: string[] | null;
  carga: { nivel: NivelCarga; texto: string | null; created_at: string } | null;
  desactualizada: boolean;
}
export interface CampusSinTutor { id: number; campus: string; empresa: string | null }

export interface MediaMediana { media: number | null; mediana: number | null }
export interface FilaRanking { id: number; nombre: string; consultas: number; pendientes: number; primeraRespuestaHoras: MediaMediana; enPlazoPct: number | null }
export interface Metricas {
  plazoHoras: number;
  consultas: {
    volumen: number;
    respondidas: number;
    primeraRespuestaHoras: MediaMediana;
    resolucionHoras: MediaMediana;
    enPlazoPct: number | null;
    pendientes: { total: number; mediaHoras: number | null; maximaHoras: number | null };
    fueraDePlazo: Array<{ id: number; alumno_nombre: string | null; campus: string; tutor: string | null; estado: EstadoConsulta; entrada_at: string; horas: number }>;
    porDia: Array<{ dia: string; n: number }>;
  };
  alumnos: {
    total: number;
    sinMensajes: number;
    sinMensajesDiasMedia: number | null;
    contactadosPct: number | null;
    primerContactoDias: MediaMediana;
    matriculaAproximada: boolean;
  };
  ranking?: { tutores: FilaRanking[]; campus: FilaRanking[] };
}

export interface Ambito { projectId?: number | null; issuerId?: number | null }

const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const consultasApi = {
  mias: (f: FiltrosConsultas = {}) =>
    client.get(`/consultas/mias${qs({ estado: f.estado, buscar: f.buscar })}`) as Promise<ApiResponse<ListaConsultas>>,
  panel: (ambito: { projectId?: number | null; issuerId?: number | null }, f: FiltrosConsultas = {}) =>
    client.get(`/consultas${qs({
      projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined,
      issuerId: ambito.issuerId || undefined,
      estado: f.estado, sinTutor: f.sinTutor ? 1 : undefined, buscar: f.buscar,
    })}`) as Promise<ApiResponse<ListaConsultas>>,
  ver: (id: number) => client.get(`/consultas/${id}`) as Promise<ApiResponse<ConsultaDetalle>>,
  responder: (id: number, texto: string, adjuntos: File[]) => {
    const fd = new FormData();
    fd.append('texto', texto);
    for (const f of adjuntos) fd.append('adjuntos', f);
    return client.post(`/consultas/${id}/responder`, fd) as Promise<ApiResponse<{ enviado: boolean; error: string | null; consulta: ConsultaDetalle }>>;
  },
  reintentar: (mensajeId: number) =>
    client.post(`/consultas/mensajes/${mensajeId}/reintentar`, {}) as Promise<ApiResponse<{ enviado: boolean; error: string | null; consulta: ConsultaDetalle }>>,
  cerrar: (id: number) => client.post(`/consultas/${id}/cerrar`, {}) as Promise<ApiResponse<ConsultaDetalle>>,
  tutoresPosibles: (id: number) =>
    client.get(`/consultas/${id}/tutores`) as Promise<ApiResponse<Array<{ id: number; nombre: string; email: string }>>>,
  reasignar: (id: number, tutorId: number) =>
    client.post(`/consultas/${id}/reasignar`, { tutorId }) as Promise<ApiResponse<ConsultaDetalle>>,
  leerAhora: (ambito: { projectId?: number | null; issuerId?: number | null }) =>
    client.post(`/consultas/leer-ahora${qs({
      projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined,
      issuerId: ambito.issuerId || undefined,
    })}`, {}) as Promise<ApiResponse<Array<{ projectId: number; nuevos?: number; errores?: string[] }>>>,
  tokensDelTutor: (tutorId: number) =>
    client.get(`/consultas/tutores/${tutorId}/tokens`) as Promise<ApiResponse<Array<{ project_id: number; campus: string; estado: string | null; tiene_token: boolean }>>>,
  guardarToken: (tutorId: number, projectId: number, token: string | null) =>
    client.put(`/consultas/tutores/${tutorId}/token`, { projectId, token }) as Promise<ApiResponse<{ project_id: number; tiene_token: boolean }>>,

  /** Sin ámbito: los del tutor. Con ámbito: los de todos (administración). */
  alumnosSinMensajes: (ambito?: Ambito) =>
    client.get(`/consultas/alumnos-sin-mensajes${qs(ambito ? {
      todas: 1, projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined, issuerId: ambito.issuerId || undefined,
    } : {})}`) as Promise<ApiResponse<{ alumnos: AlumnoSinMensajes[]; diasAmbar: number; diasRojo: number }>>,
  escribirAlAlumno: (id: number, texto: string) =>
    client.post(`/consultas/alumnos/${id}/escribir`, { texto }) as Promise<ApiResponse<{ consultaId: number; enviado: boolean; error: string | null }>>,
  miCarga: () => client.get('/consultas/carga') as Promise<ApiResponse<MiCarga>>,
  guardarCarga: (nivel: NivelCarga, texto: string | null) =>
    client.post('/consultas/carga', { nivel, texto }) as Promise<ApiResponse<MiCarga>>,
  panelDeTutores: (ambito: Ambito) =>
    client.get(`/consultas/tutores-panel${qs({
      projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined, issuerId: ambito.issuerId || undefined,
    })}`) as Promise<ApiResponse<{ tutores: TutorPanel[]; campusSinTutor: CampusSinTutor[]; diasPlazoCarga: number }>>,
  campusSinTutor: (ambito: Ambito) =>
    client.get(`/consultas/campus-sin-tutor${qs({
      projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined, issuerId: ambito.issuerId || undefined,
    })}`) as Promise<ApiResponse<CampusSinTutor[]>>,
  sincronizarAlumnos: (ambito: Ambito) =>
    client.post(`/consultas/sincronizar-alumnos${qs({
      projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined, issuerId: ambito.issuerId || undefined,
    })}`, {}) as Promise<ApiResponse<Array<{ projectId: number; alumnos?: number; nuevos?: number; bajas?: number; errores?: string[] }>>>,
  /** Sin ámbito: las del tutor. Con ámbito: las de todos con el ranking (administración). */
  metricas: (f: { desde?: string; hasta?: string; tutorId?: number | null }, ambito?: Ambito) =>
    client.get(`/consultas/metricas${qs({
      desde: f.desde, hasta: f.hasta,
      ...(ambito ? {
        todas: 1, tutorId: f.tutorId || undefined,
        projectId: ambito.projectId && ambito.projectId > 0 ? ambito.projectId : undefined, issuerId: ambito.issuerId || undefined,
      } : {}),
    })}`) as Promise<ApiResponse<Metricas>>,

  /**
   * El adjunto, con la sesión (no es el enlace público del alumno).
   *
   * La ventana se abre YA, con el clic: abierta después de esperar a la descarga,
   * Safari y Firefox la bloquean sin decir nada. Y si la sesión ha caducado se
   * renueva una vez, como hace `client` con todo lo demás.
   */
  async abrirAdjunto(a: AdjuntoConsulta) {
    const ventana = window.open('', '_blank');
    try {
      const pedir = () => fetch(`${API_BASE_URL}/consultas/adjuntos/${a.id}`, {
        headers: { Authorization: `Bearer ${getAccessToken() || ''}` }, credentials: 'include',
      });
      let r = await pedir();
      if (r.status === 401) {
        const renovada = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        });
        if (renovada.ok) { setAccessToken((await renovada.json()).data.accessToken); r = await pedir(); }
      }
      if (!r.ok) throw new Error('No se ha podido abrir el adjunto.');
      const url = URL.createObjectURL(await r.blob());
      if (ventana) ventana.location.href = url;
      else window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      ventana?.close();
      throw err;
    }
  },
};

/**
 * El semáforo del plazo de primera respuesta (24 h de inicio, configurable):
 * verde hasta las tres cuartas partes del plazo, ámbar hasta el plazo y rojo
 * pasado. Solo para las abiertas: las respondidas y cerradas no esperan.
 */
export function semaforo(c: Pick<ConsultaFila, 'estado' | 'espera_desde' | 'entrada_at'>, plazoHoras: number, ahora = Date.now()) {
  if (c.estado !== 'abierta') return null;
  const desde = new Date(c.espera_desde || c.entrada_at).getTime();
  const horas = (ahora - desde) / 3_600_000;
  const color: 'verde' | 'ambar' | 'rojo' = horas >= plazoHoras ? 'rojo' : horas >= plazoHoras * 0.75 ? 'ambar' : 'verde';
  return { color, horas };
}

/** «hace 3 h», «hace 2 días»: lo que lleva esperando. */
export function haceCuanto(horas: number) {
  if (horas < 1) return `hace ${Math.max(1, Math.round(horas * 60))} min`;
  if (horas < 48) return `hace ${Math.round(horas)} h`;
  return `hace ${Math.round(horas / 24)} días`;
}
