import { z } from 'zod';
import { ESTADOS } from './certifex.model.js';

const texto = (max) => z.string().trim().max(max);
const opcional = (max) => z.union([texto(max), z.null()]).optional();

/**
 * El mensaje de un fallo de validacion, en español y para ensenar tal cual. Los de
 * cada esquema ya lo estan; lo que llega sin mensaje propio (los de zod por defecto,
 * «String must contain at least 3 character(s)») se traduce aqui, para que la pantalla
 * nunca ensene ingles tecnico.
 */
export function mensajeDeValidacion(error) {
  const issue = error?.errors?.[0];
  if (!issue) return 'Datos no validos';
  const m = issue.message || '';
  if (!/^(String must|Number must|Array must|Required|Expected|Invalid|Too (small|big))/i.test(m)) return m;
  const campo = issue.path?.length ? ` (${issue.path.join('.')})` : '';
  if (issue.code === 'too_small') {
    if (issue.type === 'string') return Number(issue.minimum) <= 1 ? `Falta un dato${campo}` : `Escribe al menos ${issue.minimum} caracteres${campo}`;
    if (issue.type === 'array') return `Elige al menos ${issue.minimum}${campo}`;
    return `El valor es demasiado pequeño${campo}`;
  }
  if (issue.code === 'too_big') {
    if (issue.type === 'string') return `No puede pasar de ${issue.maximum} caracteres${campo}`;
    if (issue.type === 'array') return `Como mucho ${issue.maximum} por vez${campo}`;
    return `El valor es demasiado grande${campo}`;
  }
  if (issue.code === 'invalid_type') return issue.received === 'undefined' ? `Falta un dato${campo}` : `Dato no valido${campo}`;
  return `Dato no valido${campo}`;
}

/**
 * El nombre tal y como saldra en el diploma: LA MISMA regla que Certifex
 * (src/registro/nombre-diploma.ts), para que el CRM no deje pasar lo que Certifex
 * rechaza ni al reves. Letras (con tildes), espacios, apostrofo, guion y punto; de 3 a
 * 160 caracteres; nombre y apellido (al menos un espacio). El apostrofo y el guion
 * tipograficos (O’Neill, los que ponen solos iOS y macOS) se cambian por los rectos.
 * null si no es un nombre aceptable.
 */
const NOMBRE = /^\p{L}[\p{L}\p{M}' .-]*\p{L}\.?$/u;
export function normalizarNombreDiploma(v) {
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[‐‑]/g, '-').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 160 || !s.includes(' ') || !NOMBRE.test(s)) return null;
  // Una tilde o una dieresis son una marca; tres seguidas sobre la misma letra ya no.
  if (/\p{M}{3,}/u.test(s)) return null;
  return s;
}

const MSG_NOMBRE = 'Escribe el nombre completo (nombre y apellidos), de 3 a 160 caracteres, solo con letras.';
const nombreDiploma = z.string({ required_error: MSG_NOMBRE, invalid_type_error: MSG_NOMBRE }).transform((t, ctx) => {
  const n = normalizarNombreDiploma(t);
  if (!n) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: MSG_NOMBRE }); return z.NEVER; }
  return n;
});

/** Texto opcional que no tumba una entrega si viene largo: se recorta. "" = null. */
const recortado = (max) => z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() ? v.trim().slice(0, max) : null) : v),
  z.union([z.string(), z.null()]).optional(),
);

/** Lo que manda Certifex. Ya viene validado alli; aqui se valida otra vez, por si acaso. */
export const recibirSchema = z.object({
  certifexId: z.number().int().positive(),
  tipo: z.enum(['centro', 'consulta']),
  nombre: texto(200).min(2),
  email: z.string().trim().email().max(254),
  telefono: opcional(40),
  organizacion: opcional(200),
  urlCampus: opcional(500),
  mensaje: z.string().trim().min(5).max(4000),
  idioma: z.union([z.enum(['es', 'en', 'fr', 'pt']), z.null()]).optional(),
  creadoEn: z.string().datetime({ offset: true }).optional().nullable(),
});

export const listarSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  tipo: z.enum(['centro', 'consulta']).optional(),
  pagina: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(100).optional(),
});

export const actualizarSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  notaInterna: z.union([texto(4000), z.null()]).optional(),
});

// --- Emisiones: lo que se le pide a la API de Certifex (/api/crm/v1) ---

export const listarEmisionesSchema = z.object({
  estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'todas']).optional(),
  centro: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, 'Centro no valido').optional(),
  pagina: z.coerce.number().int().positive().optional(),
  tam: z.coerce.number().int().positive().max(200).optional(),
  curso: z.coerce.number().int().optional(),
  q: z.string().trim().max(100).optional(),
});

export const cursosSchema = z.object({
  centro: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, 'Centro no valido'),
});

/** Quien decide NO va aqui: lo pone el servidor con el usuario de la sesion. */
export const decisionesSchema = z.object({
  items: z.array(z.object({
    matriculaId: z.number().int().positive(),
    decision: z.enum(['aprobada', 'rechazada']),
    motivo: z.union([texto(500), z.null()]).optional(),
  })).min(1, 'Elige al menos una matricula').max(200, 'Maximo 200 por vez'),
});

export const emitirSchema = z.object({
  // 10 y no 50, lo mismo que la pantalla: cada matricula de un campus con Moodle baja su
  // expediente en serie, y 50 pasan del minuto que nginx espera (504 con la emision a medias).
  matriculaIds: z.array(z.number().int().positive()).min(1, 'Elige al menos una matricula').max(10, 'Maximo 10 por vez: dividelo en tandas'),
});

// --- Diplomas (#272): solicitudes desde Moodle y el panel Diplomas ---

const centro = z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, 'Centro no valido');
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no valida (AAAA-MM-DD)');
// Prefijo de 2 a 6 letras: el de la empresa que numera (Certifex 0035) o el CTF de los antiguos.
const nexp = z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}-\d{4}-\d{6}-[A-Z0-9]{4}$/, 'Numero de expediente no valido');
const ids = (max, msg) => z.array(z.number().int().positive()).min(1, 'Elige al menos una').max(max, msg);
const motivo = z.string({ required_error: 'Indica el motivo', invalid_type_error: 'Indica el motivo' }).trim()
  .min(3, 'El motivo debe tener al menos 3 caracteres').max(500, 'El motivo no puede pasar de 500 caracteres');

/**
 * Lo que manda Certifex al pedir un alumno su diploma. SIN DNI (decision del 08/10):
 * el alumno solo escribe su nombre, y ese es el que se imprimira.
 *
 * Una solicitud legitima no se rechaza entera por un detalle: Certifex no la reenvia y
 * nadie se enteraria. Un correo vacio o mal escrito queda en null (no se enlaza con la
 * ficha, y ya), un nombre de curso larguisimo se recorta, y sin nombre para el diploma
 * entra igual (null): el panel lo ensena y se revisa antes de aprobar.
 */
export const solicitudSchema = z.object({
  matriculaId: z.number().int().positive(),
  centro,
  curso: z.object({
    ref: z.union([z.number().int(), z.null()]).optional(),
    nombre: recortado(300),
  }).optional().nullable(),
  alumno: z.object({
    nombreDiploma: recortado(200),
    nombreMoodle: recortado(200),
    email: z.preprocess((v) => {
      if (typeof v !== 'string') return null;
      const e = v.trim();
      return e && e.length <= 254 && z.string().email().safeParse(e).success ? e : null;
    }, z.union([z.string(), z.null()])),
  }),
  solicitadaEn: z.string().datetime({ offset: true }),
});

/** Filtros comunes del panel: campus, formacion, busqueda, fechas y pagina. */
const filtrosPanel = {
  centro: centro.optional(),
  curso: z.coerce.number().int().optional(),
  q: z.string().trim().max(100).optional(),
  desde: dia.optional(),
  hasta: dia.optional(),
  pagina: z.coerce.number().int().positive().optional(),
  tam: z.coerce.number().int().positive().max(200).optional(),
  // `todo=1`: todas las filas que cumplen los filtros (para exportar a Excel).
  todo: z.enum(['0', '1']).optional(),
};

export const listarSolicitudesSchema = z.object({
  estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'todas']).optional(),
  ...filtrosPanel,
});

export const listarDiplomasSchema = z.object({
  estado: z.enum(['vigentes', 'revocados', 'todos']).optional(),
  aviso: z.enum(['pendiente', 'fuera', 'enviado', 'no_salio']).optional(),
  ...filtrosPanel,
}).refine((f) => f.curso === undefined || f.centro, { message: 'Para filtrar por formacion elige antes el campus', path: ['curso'] });

export const porAvisarSchema = z.object({
  centro: centro.optional(),
  q: z.string().trim().max(100).optional(),
});

/** Aprobar y emitir: 10 por llamada, lo mismo que emitir (ver `emitirSchema`). */
export const aprobarEmitirSchema = z.object({
  matriculaIds: ids(10, 'Maximo 10 por vez: dividelo en tandas'),
});

export const emitirDiplomasSchema = aprobarEmitirSchema;

export const rechazarSchema = z.object({
  matriculaIds: ids(200, 'Maximo 200 por vez'),
  motivo,
});

export const avisosSchema = z.object({
  nexpedientes: z.array(nexp).min(1, 'Elige al menos un diploma').max(50, 'Maximo 50 por vez: dividelo en tandas'),
});

export const avisosRechazoSchema = z.object({
  matriculaIds: ids(50, 'Maximo 50 por vez: dividelo en tandas'),
});

export const revocarSchema = z.object({ nexpediente: nexp, motivo });

/**
 * El programa a imprimir escrito a mano. Mismos limites que Certifex (validarProgramaCrm):
 * horas enteras de 1 a 5000, hasta 100 modulos, titulo de 1 a 300 caracteres y horas de
 * modulo de 0 a 2000. Pasarse ahi anula la emision entera, asi que no se guarda.
 */
const programaEditado = z.object({
  horas: z.union([
    z.number({ invalid_type_error: 'Las horas deben ser un numero' }).int('Las horas deben ser un numero entero')
      .min(1, 'Las horas van de 1 a 5000').max(5000, 'Las horas van de 1 a 5000'),
    z.null(),
  ]).optional(),
  modulos: z.array(z.object({
    titulo: z.string({ required_error: 'Cada modulo necesita un titulo' }).transform((t) => t.replace(/\s+/g, ' ').trim())
      .pipe(z.string().min(1, 'Cada modulo necesita un titulo').max(300, 'El titulo de un modulo no pasa de 300 caracteres')),
    horas: z.union([
      z.number().int('Las horas de un modulo deben ser un numero entero')
        .min(0, 'Las horas de un modulo van de 0 a 2000').max(2000, 'Las horas de un modulo van de 0 a 2000'),
      z.null(),
    ]).optional(),
  })).max(100, 'Como mucho 100 modulos').default([]),
}).refine((p) => p.horas != null || p.modulos.length > 0, { message: 'El programa necesita las horas o al menos un modulo' });

/**
 * «Editar» antes de aprobar. null en un campo = quitar esa edicion. El nombre no tiene
 * null: es el que se imprime, y vive en Certifex (3 a 160 caracteres, como alli).
 */
export const editarSchema = z.object({
  matriculaId: z.number().int().positive(),
  nombre: nombreDiploma.optional(),
  emailCrm: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.union([z.string().trim().toLowerCase().email('Correo no valido').max(254), z.null()]),
  ).optional(),
  productoId: z.union([z.number().int().positive(), z.null()]).optional(),
  programa: z.union([programaEditado, z.null()]).optional(),
}).refine((d) => ['nombre', 'emailCrm', 'productoId', 'programa'].some((k) => d[k] !== undefined), { message: 'No hay nada que guardar' });

export const formacionesSchema = z.object({ centro });

/**
 * «Nuevo diploma» (Diego, 19/10: «crear el diploma desde 0, seleccionando el cliente»): el
 * campus, el cliente (un prospecto o cliente del proyecto de ese campus) y la formación del
 * catálogo. `nombre`, el que se imprimirá; sin él, el de la ficha del cliente.
 */
export const nuevoDiplomaSchema = z.object({
  centro,
  leadId: z.number().int().positive(),
  productoId: z.number().int().positive(),
  nombre: nombreDiploma.optional(),
});

/** Sincronizar el temario de una formación del catálogo con la página del curso (12/10). */
export const sincronizarTemarioSchema = z.object({ centro, productoId: z.coerce.number().int().positive() });

/**
 * Un nombre mal escrito se CORRIGE (mismo numero, auditado): no se revoca y reemite.
 * Mismos limites que Certifex (corregirCredencial): el nombre con la regla del diploma,
 * la titulacion hasta 300 caracteres y el motivo hasta 500.
 */
export const corregirSchema = z.object({
  nexpediente: nexp,
  campo: z.enum(['alumno_nombre', 'titulacion']).default('alumno_nombre'),
  valor: z.string({ required_error: 'Escribe el valor correcto', invalid_type_error: 'Escribe el valor correcto' }),
  motivo,
}).transform((d, ctx) => {
  if (d.campo === 'alumno_nombre') {
    const n = normalizarNombreDiploma(d.valor);
    if (!n) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: MSG_NOMBRE, path: ['valor'] }); return z.NEVER; }
    return { ...d, valor: n };
  }
  const t = d.valor.replace(/\s+/g, ' ').trim();
  if (!t) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Escribe el valor correcto', path: ['valor'] }); return z.NEVER; }
  if (t.length > 300) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La titulacion no puede pasar de 300 caracteres', path: ['valor'] }); return z.NEVER; }
  return { ...d, valor: t };
});

/**
 * El aviso de Certifex «ha terminado la formacion» (sin haber pedido el diploma).
 * Igual de tolerante que la solicitud: lo legitimo no se rechaza por un detalle.
 */
export const completadoSchema = z.object({
  matriculaId: z.number().int().positive(),
  centro,
  curso: z.object({
    ref: z.union([z.number().int(), z.null()]).optional(),
    nombre: recortado(300),
  }).optional().nullable(),
  alumno: z.object({
    nombreMoodle: recortado(200),
    email: z.preprocess((v) => {
      if (typeof v !== 'string') return null;
      const e = v.trim();
      return e && e.length <= 254 && z.string().email().safeParse(e).success ? e : null;
    }, z.union([z.string(), z.null()])),
  }).optional().default({ email: null }),
  // Una nota rara no tumba el aviso: queda sin nota.
  notaFinal: z.preprocess((v) => {
    const n = typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : v;
    return typeof n === 'number' && Number.isFinite(n) ? n : null;
  }, z.union([z.number(), z.null()])),
  completadoEn: z.preprocess(
    (v) => (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()) ? v : null),
    z.union([z.string(), z.null()]),
  ),
});

/** «Terminaron sin pedir»: campus, formacion, busqueda y pagina (sin fechas: Certifex no las da). */
export const listarTerminadosSchema = z.object({
  centro: centro.optional(),
  curso: z.coerce.number().int().optional(),
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().positive().optional(),
  tam: z.coerce.number().int().positive().max(200).optional(),
  todo: z.enum(['0', '1']).optional(),
});
