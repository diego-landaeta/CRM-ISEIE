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
  /** La web pública de Certifex: verificación y diploma de cada título. Null si no es pública. */
  urlPublica?: string | null;
  /**
   * ¿Los enlaces a Certifex abren desde fuera? Si no (una dirección local como 127.0.0.1),
   * los motivos, para avisar en el panel (Certifex#96).
   */
  direccionPublica?: { ok: boolean; motivos: string[] };
  error?: string;
}

/** Una matrícula de Certifex a decidir (o ya decidida). Contrato: docs/integracion-crm.md. */
export interface Candidato {
  matriculaId: number;
  centro: string;
  /** `dni` viene en el contrato, pero el CRM no lo usa ni lo enseña (decisión del 08/10). */
  titular: { nombre: string | null; email: string | null; dni: string | null };
  curso: { ref: number; nombre: string };
  notaFinal: number | null;
  umbral: number | null;
  completado: boolean | null;
  actividades: { total: number; calificadas: number };
  propuesto: boolean;
  nexpediente: string | null;
  /**
   * El alumno lo pidió desde Moodle (#272): cuándo y el nombre que escribió para el
   * diploma, que es el que se imprime. null si no lo pidió.
   */
  solicitud?: {
    en: string;
    /** El que se imprimirá: el revisado en el CRM, si lo está; si no, el del alumno. */
    nombre: string | null;
    /** Lo que escribió el alumno. */
    nombreAlumno?: string | null;
    /** Quién revisó el nombre desde el CRM, y cuándo. */
    revisado?: { por: string; en: string } | null;
  } | null;
  /** El programa oficial que mandó el CRM al emitir (horas y temario), si lo mandó. */
  programa?: ProgramaOficial | null;
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
  /**
   * La salud del enlace con su Moodle: el plugin manda un latido diario desde su tarea
   * programada, que solo corre si el cron de Moodle funciona. Un Certifex antiguo no lo
   * manda: sin el campo, no se enseña nada.
   */
  salud?: SaludMoodle | null;
}

export interface SaludMoodle {
  /** ok · sin_latido (más de 36 h) · nunca (plugin anterior a 2.7.0 o cron que no ha corrido) · sin_moodle. */
  cron: 'ok' | 'sin_latido' | 'nunca' | 'sin_moodle';
  latidoEn: string | null;
  avisoEn?: string | null;
  plugin: string | null;
  moodle: string | null;
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
export interface ResultadoEmision {
  matriculaId: number | null;
  ok: boolean;
  nexpediente?: string;
  yaExistia?: boolean;
  error?: string;
  /** 'emitir_bloqueado': revisada a mano y sin programa; no se ha emitido. */
  fase?: string;
  /** Con programa del CRM: lo que se mandó. */
  programa?: { horas: number | null; modulos: number; formacion: string | null; editado?: boolean };
  /** Sin programa del CRM (se usó lo de Moodle): por qué. */
  sinPrograma?: string;
}

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
  diploma: async (nexpediente: string, version?: number): Promise<Blob> => {
    const t = getAccessToken();
    // `version`: tras corregir un diploma, para no ver la copia de antes (el servidor la
    // deja en caché unos minutos).
    const v = version ? `?v=${version}` : '';
    const r = await fetch(`${API_BASE_URL}/certifex/emisiones/diploma/${encodeURIComponent(nexpediente)}${v}`, {
      credentials: 'include',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error || `Error ${r.status}`);
    }
    return r.blob();
  },
  /**
   * El A3 de imprenta de un diploma (#95 de Certifex). No es público: lo pide el servidor
   * del CRM con su clave. Devuelve el fichero y el nombre con el que guardarlo.
   */
  diplomaImprenta: async (nexpediente: string): Promise<{ blob: Blob; nombre: string }> => {
    const t = getAccessToken();
    const r = await fetch(`${API_BASE_URL}/certifex/emisiones/diploma/${encodeURIComponent(nexpediente)}?formato=imprenta`, {
      credentials: 'include',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error || `Error ${r.status}`);
    }
    return { blob: await r.blob(), nombre: `${nexpediente}-imprenta-A3.pdf` };
  },
};

// --- Diplomas (#272): lo que el alumno pide desde Moodle y los diplomas emitidos ---
// Emitir NO avisa al alumno: el correo sale solo cuando alguien lo aprueba aquí.

export type PestanaDiplomas = 'pendientes' | 'terminados' | 'enviados' | 'rechazados' | 'revocados';
export type ResultadoAviso = 'enviado' | 'correo_apagado' | 'sin_correo' | 'error';
/** 'fuera': emitido fuera del CRM (desde Certifex, o los antiguos) y sin aviso. */
export type FiltroAviso = 'pendiente' | 'fuera' | 'enviado' | 'no_salio';

/** Horas y temario de la formación vendida, tal y como se imprimen en el diploma. */
export interface ProgramaOficial {
  horas?: number | null;
  modulos: { titulo: string; horas?: number | null }[];
}

/**
 * El programa que se imprimiría si se emite ahora: el de la formación que compró el
 * alumno en el CRM. `programa` null = se usará lo de Moodle, y `motivo` dice por qué.
 */
export interface ProgramaDelCrm {
  programa: ProgramaOficial | null;
  formacion: { id: number; nombre: string; numModulos: number | null } | null;
  motivo: string | null;
  /** El programa lo escribió alguien a mano («Editar»): se imprime eso. */
  editado?: boolean;
  /** La formación vendida se eligió a mano del catálogo. */
  elegida?: boolean;
  /** Con algo revisado a mano: lo que habría salido solo (la formación «Automática»). */
  auto?: { programa: ProgramaOficial | null; formacion: ProgramaDelCrm['formacion']; motivo: string | null };
}

/** Lo revisado a mano antes de aprobar (migración 230): con qué datos se trabaja. */
export interface EdicionSolicitud {
  /** El correo con el que se busca al alumno en el CRM, si no es el de Moodle. */
  emailCrm: string | null;
  /** La formación vendida, elegida del catálogo. */
  productoId: number | null;
  /** El programa a imprimir, escrito a mano. */
  programaEditado: ProgramaOficial | null;
  por: string | null;
  en: string | null;
}

/** Una formación del catálogo del campus, para elegir la vendida. */
export interface FormacionCatalogo {
  id: number;
  nombre: string;
  activa: boolean;
  horas: number | null;
  numModulos: number | null;
  modulos: { titulo: string; horas?: number | null }[];
}

/** Lo que devuelve «Sincronizar con el producto»: la formación ya con sus módulos. */
export interface TemarioSincronizado {
  formacion: FormacionCatalogo | null;
  modulos: number;
  fuente: string | null;
  /** Por qué no se cargó nada (la página no separa el temario, no abre…). */
  motivo: string | null;
}

export interface CatalogoDelCampus {
  proyecto: { id: number; nombre: string } | null;
  /** Por qué no hay catálogo (el campus no casa con un proyecto del CRM). */
  motivo: string | null;
  formaciones: FormacionCatalogo[];
}

/** «Editar»: null en un campo quita esa edición; sin el campo, no se toca. */
export interface CambiosSolicitud {
  matriculaId: number;
  nombre?: string;
  emailCrm?: string | null;
  productoId?: number | null;
  programa?: ProgramaOficial | null;
}

/** Una solicitud de diploma: un candidato de Certifex que lo pidió desde Moodle. */
export interface Solicitud extends Candidato {
  /** Solo sin diploma: el programa que se mandará al emitir. */
  programaCrm?: ProgramaDelCrm | null;
  /** Solo sin diploma: lo revisado a mano antes de aprobar. */
  edicion?: EdicionSolicitud | null;
  /** El aviso de rechazo que ya se aprobó (solo en las rechazadas). */
  avisoRechazo?: { en: string; por: string; resultado: string } | null;
  /** Solo en «por avisar»: el diploma emitido. */
  diploma?: Diploma | null;
}

export interface Diploma {
  nexpediente: string;
  centro: string;
  alumno: string;
  titulacion: string;
  cursoRef: number | null;
  emitidoEn: string | null;
  emitidaPor: string | null;
  revocada: boolean;
  revocacion: { en: string | null; motivo: string | null; por: string | null } | null;
  /** Null si Certifex no tiene dirección pública (`sinEnlaces` en la lista dice por qué). */
  verificarUrl: string | null;
  diplomaUrl: string | null;
  aviso: { resultado: ResultadoAviso; en: string; por: string } | null;
  /** Lo emitió este CRM («persona (CRM …)»). Lo emitido fuera no está «pendiente de aviso». */
  emitidoEnCrm?: boolean;
  /** Su diploma tiene versión de imprenta A3 (hoy, solo ISEIE). La da Certifex. */
  imprenta?: boolean;
}

/**
 * «Terminaron sin pedir»: Moodle da la formación por terminada y el alumno aún no ha
 * pedido su diploma. Solo consulta. `aviso`: cuándo lo dio Moodle por terminado y cuándo
 * llegó el aviso al CRM (null si no llegó).
 */
export interface Terminado extends Candidato {
  aviso?: { en: string | null; recibidoEn: string | null; nota: number | null } | null;
}

export interface Pagina<T> { filas: T[]; total: number; pagina: number; tam: number; truncado?: boolean }

export interface ResumenDiplomas {
  pendientes: number;
  rechazadas: number;
  vigentes: number;
  revocados: number;
  porAvisar: number;
  sinEmitir: number;
  /** Terminaron en Moodle y aún no han pedido el diploma. */
  terminados?: number;
  /** «Por enviar al alumno»: lo mismo que el filtro «Pendiente de aviso» de Emitidos. */
  porEnviar?: number;
}

export interface FiltrosDiplomas {
  centro?: string;
  curso?: number;
  q?: string;
  desde?: string;
  hasta?: string;
  pagina?: number;
  tam?: number;
  todo?: '1';
}

export interface ResultadoAprobarEmitir {
  matriculaId: number;
  ok: boolean;
  fase?: 'aprobar' | 'emitir' | 'emitir_bloqueado';
  nexpediente?: string;
  yaExistia?: boolean;
  error?: string;
  /** Con programa del CRM: lo que se mandó. */
  programa?: { horas: number | null; modulos: number; formacion: string | null; editado?: boolean };
  /** Sin programa del CRM (se usó lo de Moodle): por qué. */
  sinPrograma?: string;
}
export interface RespuestaAvisos { correoActivo: boolean; resultados: { nexpediente: string | null; ok: boolean; resultado?: ResultadoAviso; error?: string }[] }
export interface RespuestaAvisosRechazo { correoActivo: boolean; resultados: { matriculaId: number | null; ok: boolean; resultado?: string; error?: string }[] }

const qs = (f: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  return p.toString();
};

export const diplomasApi = {
  resumen: (centro?: string) => client.get(`/certifex/diplomas/resumen?${qs({ centro })}`) as R<ResumenDiplomas>,
  solicitudes: (f: FiltrosDiplomas & { estado?: 'pendiente' | 'aprobada' | 'rechazada' | 'todas' }) =>
    client.get(`/certifex/diplomas/solicitudes?${qs(f)}`) as R<Pagina<Solicitud>>,
  /** Solo consulta: terminaron en Moodle y aún no han pedido el diploma. */
  terminados: (f: Omit<FiltrosDiplomas, 'desde' | 'hasta'>) =>
    client.get(`/certifex/diplomas/terminados?${qs(f)}`) as R<Pagina<Terminado>>,
  porAvisar: (f: { centro?: string; q?: string }) =>
    client.get(`/certifex/diplomas/por-avisar?${qs(f)}`) as R<{ porAvisar: Solicitud[]; sinEmitir: Solicitud[]; truncado?: boolean }>,
  diplomas: (f: FiltrosDiplomas & { estado?: 'vigentes' | 'revocados' | 'todos'; aviso?: FiltroAviso }) =>
    client.get(`/certifex/diplomas?${qs(f)}`) as R<Pagina<Diploma>>,
  aprobarEmitir: (matriculaIds: number[]) =>
    client.post('/certifex/diplomas/aprobar-emitir', { matriculaIds }) as R<{ resultados: ResultadoAprobarEmitir[] }>,
  /** Emitir lo ya aprobado (reintento), también con el programa del CRM. */
  emitir: (matriculaIds: number[]) =>
    client.post('/certifex/diplomas/emitir', { matriculaIds }) as R<{ resultados: ResultadoAprobarEmitir[] }>,
  rechazar: (matriculaIds: number[], motivo: string) =>
    client.post('/certifex/diplomas/rechazar', { matriculaIds, motivo }) as R<{ resultados: ResultadoDecision[] }>,
  avisos: (nexpedientes: string[]) => client.post('/certifex/diplomas/avisos', { nexpedientes }) as R<RespuestaAvisos>,
  avisosRechazo: (matriculaIds: number[]) =>
    client.post('/certifex/diplomas/avisos-rechazo', { matriculaIds }) as R<RespuestaAvisosRechazo>,
  revocar: (nexpediente: string, motivo: string) =>
    client.post('/certifex/diplomas/revocar', { nexpediente, motivo }) as R<{ ok: true; nexpediente: string }>,
  corregirNombre: (nexpediente: string, valor: string, motivo: string) =>
    client.post('/certifex/diplomas/corregir', { nexpediente, campo: 'alumno_nombre', valor, motivo }) as R<{ ok: true; nexpediente: string }>,
  /**
   * Revisar antes de aprobar (solo sin diploma): el nombre va a Certifex; el correo del
   * CRM, la formación y el programa se guardan en el CRM. Devuelve la fila actualizada.
   */
  editar: (cambios: CambiosSolicitud) => client.post('/certifex/diplomas/editar', cambios) as R<Solicitud>,
  /**
   * «Nuevo diploma» (19/10): la solicitud desde cero, eligiendo el cliente y la formación.
   * Queda en «Por decidir» para aprobarla y emitirla como las que llegan de Moodle.
   */
  nuevo: (d: { centro: string; leadId: number; productoId: number; nombre?: string }) =>
    client.post('/certifex/diplomas/nuevo', d) as R<{ matriculaId: number; yaExistia: boolean; centro: string; curso: string; nombre: string }>,
  /** Las formaciones del catálogo del proyecto de ese campus, para elegir la vendida. */
  formaciones: (centro: string) => client.get(`/certifex/diplomas/formaciones?${qs({ centro })}`) as R<CatalogoDelCampus>,
  /** Los módulos de esa formación, leídos de la página del curso y guardados en el catálogo (12/10). */
  sincronizarTemario: (centro: string, productoId: number) =>
    client.post('/certifex/diplomas/formaciones/sincronizar', { centro, productoId }) as R<TemarioSincronizado>,
};
