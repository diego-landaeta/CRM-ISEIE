import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';

/** Una consulta que llega desde la web de Certifex (migración 173). */
export type EstadoConsulta = 'nueva' | 'en_curso' | 'resuelta' | 'spam';

export interface ConsultaCertifex {
  id: number;
  certifexId: number;
  tipo: 'centro' | 'consulta';
  nombre: string;
  email: string;
  telefono: string | null;
  organizacion: string | null;
  urlCampus: string | null;
  mensaje: string;
  idioma: string | null;
  estado: EstadoConsulta;
  notaInterna: string | null;
  atendidaPor: string | null;
  recibidaEn: string;
  creadaEnCertifex: string | null;
  updatedAt: string;
}

export interface Bandeja {
  filas: ConsultaCertifex[];
  total: number;
  pagina: number;
  limite: number;
  nuevas: number;
}

export const certifexApi = {
  listar: (f: { estado?: EstadoConsulta; tipo?: 'centro' | 'consulta'; pagina?: number } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
    return client.get(`/certifex/consultas?${p.toString()}`) as Promise<{ success: boolean; data: Bandeja; error?: string }>;
  },
  actualizar: (id: number, b: { estado?: EstadoConsulta; notaInterna?: string | null }) =>
    client.patch(`/certifex/consultas/${id}`, b) as Promise<{ success: boolean; data: ConsultaCertifex; error?: string }>,
};

// --- Emisiones: el visto bueno y la emisión de títulos en Certifex ---
// El CRM habla con Certifex desde su servidor; aquí solo se llama al backend del CRM.

export type EstadoEmision = 'pendiente' | 'aprobada' | 'rechazada' | 'todas';

export interface ConexionCertifex {
  conectado: boolean;
  nombre?: string;
  centros?: string[];
  /** La web pública de Certifex: verificación y diploma de cada título. */
  urlPublica?: string | null;
  error?: string;
}

/** Una matrícula de Certifex a decidir (o ya decidida). Contrato: docs/integracion-crm.md. */
export interface Candidato {
  matriculaId: number;
  centro: string;
  titular: { nombre: string | null; email: string | null; dni: string | null };
  curso: { ref: number; nombre: string };
  notaFinal: number | null;
  umbral: number | null;
  completado: boolean | null;
  actividades: { total: number; calificadas: number };
  propuesto: boolean;
  nexpediente: string | null;
  /**
   * Lo que el CRM sabe de ese correo, en los campus que ve quien mira: `null` si no
   * está en el CRM; sin el campo si el cruce falló (el listado sale igual).
   */
  crm?: EnElCrm | null;
  decision: {
    decision: 'aprobada' | 'rechazada';
    motivo: string | null;
    decididoPor: string;
    decididoEn: string;
    refExterna: string | null;
  } | null;
}

/** Un alumno de Certifex visto desde el CRM: sus fichas y lo que compró y pagó. */
export interface EnElCrm {
  leadId: number;
  fichas: number;
  ventas: number;
  vendido: number;
  cobrado: number;
  pendiente: number;
}

/** Recuentos de lo que hay que hacer: por decidir, listo para emitir, rechazado, emitido. */
export interface Recuentos {
  matriculados: number;
  porDecidir: number;
  aprobadasSinEmitir: number;
  rechazadas: number;
  emitidas: number;
}

/** Un campus de Certifex conectado a este CRM. */
export interface CampusCertifex extends Recuentos {
  codigo: string;
  nombre: string;
  moodleUrl: string | null;
  /** Ruta del logo en la web de Certifex (relativa a `urlPublica`). */
  logo: string | null;
  activo: boolean;
  cursos: number;
}

export interface CursoCertifex extends Recuentos {
  cursoRef: number;
  cursoNombre: string;
}

export interface PaginaCandidatos {
  filas: Candidato[];
  total: number;
  pagina: number;
  tam: number;
}

export interface ResultadoDecision { matriculaId: number | null; ok: boolean; error?: string; decision?: string; yaEmitida?: string }
export interface ResultadoEmision { matriculaId: number | null; ok: boolean; nexpediente?: string; yaExistia?: boolean; error?: string }

type R<T> = Promise<{ success: boolean; data: T; error?: string }>;

export const emisionesApi = {
  estado: () => client.get('/certifex/emisiones/estado') as R<ConexionCertifex>,
  centros: () => client.get('/certifex/emisiones/centros') as R<CampusCertifex[]>,
  cursos: (centro: string) => client.get(`/certifex/emisiones/cursos?centro=${encodeURIComponent(centro)}`) as R<CursoCertifex[]>,
  listar: (f: { estado?: EstadoEmision; centro?: string; pagina?: number; curso?: number; q?: string } = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, String(v));
    return client.get(`/certifex/emisiones?${p.toString()}`) as R<PaginaCandidatos>;
  },
  decidir: (items: { matriculaId: number; decision: 'aprobada' | 'rechazada'; motivo?: string | null }[]) =>
    client.post('/certifex/emisiones/decisiones', { items }) as R<{ resultados: ResultadoDecision[] }>,
  emitir: (matriculaIds: number[]) =>
    client.post('/certifex/emisiones/emitir', { matriculaIds }) as R<{ resultados: ResultadoEmision[] }>,
  /** El logo de un campus, traído por el servidor del CRM para poder medir su brillo. */
  logo: async (ruta: string): Promise<Blob> => {
    const t = getAccessToken();
    const r = await fetch(`${API_BASE_URL}/certifex/emisiones/logo?ruta=${encodeURIComponent(ruta)}`, {
      credentials: 'include',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return r.blob();
  },
  /** El PDF del diploma, traído por el servidor del CRM (Certifex no se deja incrustar). */
  diploma: async (nexpediente: string): Promise<Blob> => {
    const t = getAccessToken();
    const r = await fetch(`${API_BASE_URL}/certifex/emisiones/diploma/${encodeURIComponent(nexpediente)}`, {
      credentials: 'include',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error || `Error ${r.status}`);
    }
    return r.blob();
  },
};
