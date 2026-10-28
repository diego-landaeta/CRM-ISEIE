import crypto from 'node:crypto';
import { z } from 'zod';
import { revisarUrl } from '../webhooks-salientes/webhooks-salientes.validation.js';

/*
  ASIGNACIÓN DE LEADS POR ACTIVIDAD (CRM#513, 27/10/2026): lo que se acepta.

  La ENTRADA recibe lo mismo que hoy manda Make al crear un lead (los campos del
  webhook de leads: nombre, email, teléfono, producto, UTM, landing…), más:
    · `uid`: un identificador único del formulario. Si Make reintenta, no se
      decide ni se crea dos veces.
    · `original` (opcional): el correo del formulario tal cual (asunto, html,
      texto). Si viene, es lo que se reenvía al escenario por mailhook, para que
      el escenario lo reciba «como desde la web».
    · `project_id` o `proyecto` (slug): solo si la configuración es de una
      empresa o de todas; con la de un campus, el campus es ese.
*/

export const TIPOS_DESTINO = ['mailhook', 'webhook'];
export const AMBITOS = ['todas', 'empresa', 'campus'];

const correo = z.string().trim().toLowerCase().email('El mailhook tiene que ser una dirección de correo (la que da Make)');

/** Un destino: o una dirección de correo (mailhook) o una URL https (webhook). */
export function revisarDestino(tipo, valor) {
  const v = String(valor || '').trim();
  if (!v) return 'Falta el destino';
  if (tipo === 'mailhook') return correo.safeParse(v).success ? null : 'El mailhook tiene que ser una dirección de correo (la que da Make)';
  return revisarUrl(v);
}

const destino = z.object({
  tipo: z.enum(TIPOS_DESTINO, { message: 'El destino es un mailhook (correo) o un webhook (URL)' }),
  valor: z.string().trim().min(1, 'Falta el destino').max(500),
}).superRefine((d, ctx) => {
  const problema = revisarDestino(d.tipo, d.valor);
  if (problema) ctx.addIssue({ code: 'custom', message: problema, path: ['valor'] });
});

const id = z.coerce.number().int().positive();

export const crearConfigSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre').max(150),
  activo: z.boolean().default(true),
  ambito: z.enum(AMBITOS).default('campus'),
  issuer_id: id.nullable().optional(),
  project_id: id.nullable().optional(),
  ventana_min: z.coerce.number().int().min(1, 'La ventana va de 1 a 240 minutos').max(240, 'La ventana va de 1 a 240 minutos').default(15),
  escenario1: destino,
  escenario2: destino,
});

export const cambiarConfigSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre').max(150).optional(),
  activo: z.boolean().optional(),
  ventana_min: z.coerce.number().int().min(1).max(240).optional(),
  escenario1: destino.optional(),
  escenario2: destino.optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No hay nada que cambiar' });

export const pruebaSchema = z.object({
  escenario: z.coerce.number().int().refine((n) => n === 1 || n === 2, 'El escenario es 1 o 2'),
});

export const listarDecisionesSchema = z.object({
  destino_id: id.optional(),
  project_id: id.optional(),
  escenario: z.coerce.number().int().refine((n) => n === 1 || n === 2).optional(),
  estado: z.enum(['pendiente', 'enviando', 'enviado', 'fallido']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Lo propio de la entrada; el resto de campos se valida con el esquema del webhook de leads. */
export const entradaSchema = z.object({
  uid: z.string().trim().min(1, 'Falta el uid del formulario').max(200),
  original: z.object({
    asunto: z.string().max(500).optional(),
    html: z.string().max(200000).optional(),
    texto: z.string().max(100000).optional(),
    remitente: z.string().max(300).optional(),
  }).partial().optional(),
  project_id: id.optional(),
  proyecto: z.string().trim().max(120).optional(),
}).passthrough();

/**
 * El error para quien monta el escenario de Make: qué campo y qué le pasa. Zod
 * dice «Required» a secas, y con eso no se sabe qué falta (prueba del 27/10).
 */
export function motivoDelFallo(issue) {
  const campo = (issue?.path || []).join('.');
  const falta = (issue?.code === 'invalid_type' && ['undefined', 'null'].includes(issue.received))
    || (issue?.code === 'too_small' && issue?.type === 'string' && issue?.minimum === 1);
  if (campo && falta) return `Falta el campo «${campo}»`;
  if (/[áéíóúñ]|Falta/.test(issue?.message || '')) return issue.message;
  return campo ? `El campo «${campo}» no es válido: ${issue?.message || 'revísalo'}` : (issue?.message || 'Datos no válidos');
}

/*
  EL JSON QUE YA SACA MAKE (28/10/2026). Los escenarios «Contestación automática»
  de cada campus sacan del correo, con OpenAI, un JSON con `full_name`, `email`,
  `phone_complete`, `course`, `message`, `page_url`… y hoy lo mandan tal cual al
  CRM. La entrada lo acepta igual, para que en Make baste un HTTP con ese mismo
  JSON (escribir los campos a mano rompe el envío en cuanto un nombre trae comillas):
    · los nombres de ese JSON se copian a los del CRM si faltan (`full_name` →
      `nombre`, `phone_complete` → `telefono`, `course` → `producto_interes`,
      `page_url` → `landing_url`, `message` → `notas`); los originales siguen y
      llegan igual al escenario;
    · sin `uid`, se toma la huella del propio JSON: si Make reenvía el mismo
      formulario, es el mismo uid y no se duplica.
*/
const ALIAS = [['nombre', ['full_name', 'name']], ['telefono', ['phone_complete', 'phone']],
  ['producto_interes', ['course']], ['landing_url', ['page_url']], ['notas', ['message']]];
const vacio = (v) => v == null || String(v).trim() === '';
const ordenado = (v) => (Array.isArray(v) ? v.map(ordenado)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])])) : v);

/*
  Y CON EL CORREO ORIGINAL. Para que el escenario 1 reciba el formulario tal cual
  llegó de la web, la entrada de Make lo manda como formulario codificado (Make
  escapa los valores; meterlos a mano en un JSON se rompe con comillas o saltos):
    json   = el JSON de OpenAI          asunto / texto / html = el correo original
*/
function desenvolver(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return {};
  const { json, asunto, texto, html, remitente, ...resto } = cuerpo;
  let base = resto;
  if (typeof json === 'string' && json.trim()) {
    try {
      const dentro = JSON.parse(json);
      if (dentro && typeof dentro === 'object' && !Array.isArray(dentro)) base = { ...dentro, ...resto };
    } catch { /* no era JSON: se queda como estaba y la validación dirá qué falta */ }
  }
  const original = { ...(base.original || {}) };
  for (const [k, v] of Object.entries({ asunto, texto, html, remitente })) if (!vacio(v)) original[k] = String(v);
  return Object.keys(original).length ? { ...base, original } : base;
}

export function prepararEntrada(entrada) {
  const cuerpo = desenvolver(entrada);
  const d = { ...cuerpo };
  for (const [campo, alias] of ALIAS) {
    if (!vacio(d[campo])) continue;
    const de = alias.find((a) => !vacio(d[a]));
    if (de) d[campo] = String(d[de]).trim();
  }
  if (vacio(d.uid)) {
    d.uid = 'auto-' + crypto.createHash('sha256').update(JSON.stringify(ordenado(cuerpo || {}))).digest('hex').slice(0, 32);
  }
  return d;
}

/** Lo que la entrada nunca puede decidir: la gestora y la clave la pone el CRM. */
export const CAMPOS_QUE_PONE_EL_CRM = ['responsable_id', 'responsable_email', 'responsable_nombre', 'responsable_whatsapp', 'idempotency_key'];
