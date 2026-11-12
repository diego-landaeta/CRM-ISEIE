import { query } from '../config/db.js';
import { base } from './email-plantilla.service.js';

/*
  LA MARCA DE UN CORREO QUE ES DE UNA EMPRESA, Y NO DE UN CAMPUS (11/11/2026).

  Diego, 11/11: «el correo de CEDIA y eso salen y que Fono Aprende, eso no es
  correcto». La bienvenida, los avisos de una tarea sin campus y los resúmenes
  buscaban «el primer campus» de la persona —el primero con remitente «no
  contestar»— y en CEDIA ese es Fono Aprende: la cabecera llevaba su logo, el
  remitente era «Fono Aprende <no-responder@fonoaprende.com>» y el asunto decía
  «Bienvenida al CRM de Fono Aprende» a gente que trabaja para los ocho campus.

  La regla, la misma que en el menú del CRM:

    · Un correo de UN campus (la tarea de Fono Aprende, el prospecto de ISEF)
      sigue con la marca de ese campus. Eso está bien y no se toca.
    · Un correo de una EMPRESA lleva la marca de la empresa: su nombre corto
      («CEDIA») y su logo si lo tiene. Si no lo tiene, solo el nombre: NUNCA el
      logo de uno de sus campus.
    · Una empresa de un solo campus (ISEIE, Lateral Thinking → ACADEMIA IA) es
      ese campus: su marca es la del campus. En ISEIE, además, la imagen de
      facturación de la sociedad es el SELLO, no el logo (Diego, 29/09).
    · Lo que mezcla empresas, o no tiene ninguna, va con la del CRM (null).

  Una marca de empresa no tiene `id` de campus: sale por la cuenta del CRM y
  con el nombre de la empresa como remitente («CEDIA <noresponder@…>»), no por
  la cuenta ni con la dirección de un campus suyo.
*/

/** El nombre corto: el alias si lo tiene («Solvenic»); si no, la primera palabra de la razón social («CEDIA»). */
export function nombreCortoDeEmpresa({ alias = null, razon_social: razonSocial = '' } = {}) {
  const a = String(alias || '').trim();
  if (a) return a;
  return String(razonSocial || '').trim().split(/[\s,]+/)[0] || 'Empresa';
}

/**
 * El logo de la empresa en una dirección absoluta (vale en un correo): la de
 * fuera tal cual; la del logo subido al CRM (`/api/invoices/issuers/:id/logo`,
 * pública) con la raíz del CRM delante. Sin logo, null.
 */
export function logoDeEmpresa({ id, logo_url: logoUrl, con_logo_subido: subido }) {
  const u = String(logoUrl || '').trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/api/')) return `${base()}${u}`;
  if (subido) return `${base()}/api/invoices/issuers/${id}/logo`;
  return null;
}

const CAMPUS = `SELECT p.id, p.nombre, p.slug, p.logo_url, p.emoji, p.sociedad_emisora_id AS sociedad_id
                  FROM projects p`;

/**
 * La marca de una empresa (`invoice_issuers.id`).
 *
 * Con un solo campus activo, la del campus. Con varios (o ninguno), la de la
 * empresa: `{ id: null, nombre, logo_url, empresa_id, de_empresa: true }`.
 */
export async function marcaDeLaEmpresa(issuerId) {
  if (!issuerId) return null;
  const { rows: [e] } = await query(
    `SELECT i.id, i.razon_social, i.alias, i.logo_url, (i.logo_key IS NOT NULL) AS con_logo_subido
       FROM invoice_issuers i WHERE i.id = $1`, [issuerId]);
  if (!e) return null;
  const { rows: campus } = await query(
    `${CAMPUS} WHERE p.sociedad_emisora_id = $1 AND p.active AND NOT COALESCE(p.es_prueba, false)
      ORDER BY p.id`, [issuerId]);
  if (campus.length === 1) return { ...campus[0], empresa_id: Number(e.id) };
  return {
    id: null,
    nombre: nombreCortoDeEmpresa(e),
    logo_url: logoDeEmpresa(e),
    empresa_id: Number(e.id),
    de_empresa: true,
  };
}

/**
 * La marca de un conjunto de campus: la del campus si es uno; la de su empresa
 * si son varios de la misma; la del CRM (null) si mezclan empresas o alguno no
 * tiene. Los campus de pruebas no cuentan.
 */
export async function marcaDeLosCampus(projectIds = []) {
  const ids = [...new Set((projectIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return null;
  const { rows } = await query(
    `${CAMPUS} WHERE p.id = ANY($1::int[]) AND p.active AND NOT COALESCE(p.es_prueba, false)
      ORDER BY p.id`, [ids]);
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const sociedades = new Set(rows.map((r) => r.sociedad_id));
  if (sociedades.size !== 1 || rows[0].sociedad_id === null) return null;
  return marcaDeLaEmpresa(rows[0].sociedad_id);
}

/** La marca con la que le llega un correo a una persona del equipo: la de sus campus. */
export async function marcaDeLaPersona({ userId = null, email = null } = {}) {
  if (!userId && !email) return null;
  const { rows } = await query(
    `SELECT up.project_id
       FROM users u JOIN user_projects up ON up.user_id = u.id AND up.active
      WHERE ${userId ? 'u.id = $1' : 'lower(u.email) = lower($1)'}`, [userId || email]);
  return marcaDeLosCampus(rows.map((r) => r.project_id));
}

/** Lo que `sendEmail` necesita de una marca: por qué cuenta sale y con qué nombre. */
export function remitenteDe(marca) {
  if (!marca) return { projectId: null, fromName: undefined };
  return { projectId: marca.id ?? null, fromName: marca.nombre || undefined };
}
