import { z } from 'zod';

export const responderSchema = z.object({
  texto: z.string({ required_error: 'Falta la respuesta' }).trim()
    .min(1, 'Falta la respuesta: escríbela en «Tu respuesta».')
    .max(20000, 'La respuesta es demasiado larga: como mucho 20 000 caracteres.'),
});

export const reasignarSchema = z.object({
  tutorId: z.coerce.number({ invalid_type_error: 'Elige el tutor' }).int().positive('Elige el tutor'),
});

export const tokenTutorSchema = z.object({
  projectId: z.coerce.number({ invalid_type_error: 'Elige el campus' }).int().positive('Elige el campus'),
  // null o vacío: quitar el token.
  token: z.string().trim().max(200, 'Ese token es demasiado largo').nullable().optional(),
});

export const listarSchema = z.object({
  estado: z.enum(['pendientes', 'abierta', 'respondida', 'cerrada']).optional(),
  sinTutor: z.enum(['1', 'true']).optional(),
  buscar: z.string().trim().max(100).optional(),
});

// ─── Fase 3 (#189) ───────────────────────────────────────────────────────────

export const escribirSchema = z.object({
  texto: z.string({ required_error: 'Falta el mensaje' }).trim()
    .min(1, 'Falta el mensaje: escríbelo en «Mensaje al alumno».')
    .max(20000, 'El mensaje es demasiado largo: como mucho 20 000 caracteres.'),
});

export const cargaSchema = z.object({
  nivel: z.enum(['baja', 'media', 'alta', 'completa'], {
    errorMap: () => ({ message: 'Falta el nivel: elige baja, media, alta o completa en «Nivel de carga».' }),
  }),
  texto: z.string().trim().max(2000, 'El texto, como mucho 2000 caracteres.').nullable().optional(),
});

// Una fecha que existe: «2026-13-45» pasaba el formato y la base daba un 500.
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD')
  .refine((v) => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; },
    'Esa fecha no existe: revísala (AAAA-MM-DD).');
export const metricasSchema = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
  tutorId: z.coerce.number().int().positive().optional(),
});

// ─── El plugin del CRM en cada Moodle (#679) ─────────────────────────────────
// Lo que llega del campus, sin sesión: la puerta es el código (al conectar) o la firma
// (cada aviso). Aun con la firma buena, el cuerpo se valida entero y con topes: que un
// campus con un plugin viejo o roto no meta cualquier cosa (revisión de la #689, 8e).

/** Un id de Moodle (número o texto con número, como lo manda PHP), mayor que 0. */
const idMoodle = z.coerce.number().int().positive();
const textoOpcional = (max) => z.string().max(max).nullish();

/** Una persona del campus, tal como la cuenta el plugin (classes/aviso.php, `usuario`). */
const personaDelCampus = z.object({
  id: idMoodle,
  nombre: textoOpcional(500),
  email: textoOpcional(320),
  personal: z.boolean().optional(),
  tutora: z.boolean().optional(),
}).passthrough();

/**
 * El aviso de un mensaje (classes/aviso.php, `del_mensaje`). Lo mismo llega por el aviso
 * firmado y por el repaso de cada 15 minutos (`local_crm_mensajes_desde`). En un privado
 * hace falta a quién va (`para`); en un chat de grupo del plugin, su alumno; en la
 * conversación de un grupo del curso (`grupo.tipo = 'curso'`), ninguno de los dos: ahí
 * escribe cualquiera y, si es una tutora, no hay «alumno».
 */
export const avisoSchema = z.object({
  evento: z.literal('mensaje'),
  sitio: textoOpcional(500),
  mensaje: z.object({
    id: idMoodle,
    conversacion_id: idMoodle,
    curso_id: z.coerce.number().int().nonnegative().nullish(),
    html: textoOpcional(1_000_000),
    fecha: z.coerce.number().int().nonnegative().nullish(),
    tipo: textoOpcional(50),
  }).passthrough(),
  de: personaDelCampus,
  para: z.array(personaDelCampus).max(500).nullish(),
  grupo: z.object({
    tipo: textoOpcional(50),
    nombre: textoOpcional(500),
    alumno: personaDelCampus.nullish(),
    curso: z.object({ id: idMoodle.nullish(), nombre: textoOpcional(500) }).passthrough().nullish(),
    // Cada miembro se vuelve a filtrar al guardarlo (consultas.avisos.js, `participantesDe`).
    miembros: z.array(z.object({}).passthrough()).max(500).nullish(),
  }).passthrough().nullish(),
}).passthrough().superRefine((a, ctx) => {
  if (a.grupo) {
    if (a.grupo.tipo !== 'curso' && !a.grupo.alumno) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['grupo', 'alumno'], message: 'Aviso incompleto: falta el alumno del chat de grupo' });
    }
  } else if (!a.para?.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['para'], message: 'Aviso incompleto: falta a quién va el mensaje' });
  }
});

/** Lo que manda el plugin al conectar con el código (classes/conexion.php, `conectar`). */
const FALTAN_DATOS = 'Faltan datos: código, dirección del campus o token.';
export const conectarSchema = z.object({
  codigo: z.string({ required_error: FALTAN_DATOS, invalid_type_error: FALTAN_DATOS }).trim()
    .min(1, FALTAN_DATOS).max(200, 'El código no es válido. Genera otro en el CRM.'),
  sitio: z.string({ required_error: FALTAN_DATOS, invalid_type_error: FALTAN_DATOS }).trim()
    .min(1, FALTAN_DATOS).max(500, 'La dirección del campus es demasiado larga.'),
  token: z.string({ required_error: FALTAN_DATOS, invalid_type_error: FALTAN_DATOS }).trim()
    .min(1, FALTAN_DATOS).max(200, 'El token del campus no es válido.'),
});
