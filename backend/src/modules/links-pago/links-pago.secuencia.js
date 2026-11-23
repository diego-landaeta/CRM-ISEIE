import { query } from '../../shared/config/db.js';
import * as model from './links-pago.model.js';
import * as service from './links-pago.service.js';
import * as P from '../../shared/services/email-plantilla.service.js';
import { linksPagoActivos } from '../../shared/config/soloEnPruebas.js';
import { dinero, fecha } from './links-pago.seguimiento.emails.js';
import { logger } from '../../shared/utils/logger.js';

/*
  EL BLOQUE «LINK DE PAGO» DE LAS SECUENCIAS DE CORREO (gemela de CRM#983, #658; Diego, 21/11/2026).

  «Que la gestora no tenga que copiar el link y pegarlo.» En una plantilla de
  correo, `{{link_pago}}` es un botón «Pagar ahora» con el link de Stripe del
  curso de interés del prospecto:

    · si el prospecto ya tiene un link vivo de ese curso (pago único y sin
      venta), se reutiliza: no se crea uno por correo;
    · si no, se crea uno con el precio del catálogo del campus, a nombre de su
      responsable (al pagarse, la venta va a su nombre, como cualquier link) y
      con la caducidad de serie del campus. Queda en su ficha y en «Links de
      pago» como los demás.

  Si no se puede (sin curso de interés, curso sin precio, sin responsable, sin
  clave de links en el campus, links apagados…), el correo NO sale: un correo
  que dice «aquí tienes el link» sin link es peor que ninguno. Quien llama apunta
  el motivo en la secuencia.
*/

export const HUECO = /\{\{\s*link_pago\s*\}\}/g;
export const tieneHueco = (texto) => new RegExp(HUECO.source).test(String(texto || ''));

export class SinLinkDePago extends Error {
  constructor(motivo) { super(motivo); this.motivo = motivo; }
}

async function prospecto(leadId) {
  const { rows } = await query(
    `SELECT l.id, l.project_id, l.responsable_id, l.producto_interes_id, l.nombre,
            pr.id AS curso_id, pr.project_id AS curso_project_id, pr.nombre AS curso_nombre, pr.precio, pr.moneda
       FROM leads l
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
      WHERE l.id = $1`,
    [leadId]);
  return rows[0] || null;
}

/** El link vivo de ese curso que ya tenga el prospecto (pago único, sin venta), o null. */
async function linkVivo(leadId, productId) {
  const { rows } = await query(
    `SELECT id FROM payment_links
      WHERE lead_id = $1 AND product_id = $2 AND estado IN ('creado', 'abierto')
        AND modalidad = 'unico' AND conversion_id IS NULL AND installment_id IS NULL
        AND url IS NOT NULL AND caduca_el > NOW() + INTERVAL '1 day'
      ORDER BY id DESC LIMIT 1`,
    [leadId, productId]);
  return rows[0] ? model.porId(rows[0].id) : null;
}

/**
 * El link del curso del prospecto: el vivo que tenga o uno nuevo. Lanza
 * `SinLinkDePago` con el motivo si no se puede.
 */
export async function linkDelProspecto(leadId, { env = process.env } = {}) {
  if (!linksPagoActivos(env)) throw new SinLinkDePago('los links de pago están apagados en este servidor');
  const l = await prospecto(leadId);
  if (!l) throw new SinLinkDePago('el prospecto no existe');
  if (!l.curso_id) throw new SinLinkDePago('el prospecto no tiene curso de interés');
  if (Number(l.curso_project_id) !== Number(l.project_id)) throw new SinLinkDePago('el curso de interés no es del catálogo de su campus');
  if (!(Number(l.precio) > 0)) throw new SinLinkDePago('el curso de interés no tiene precio en el catálogo');
  if (!l.responsable_id) throw new SinLinkDePago('el prospecto no tiene responsable: el link y la venta irían a nombre de nadie');

  const ya = await linkVivo(l.id, l.curso_id);
  if (ya) return { link: ya, nuevo: false };

  const cfg = await model.config(l.project_id);
  if (!cfg) throw new SinLinkDePago('el campus no existe');
  const prod = { id: l.curso_id, nombre: l.curso_nombre, precio: l.precio, moneda: l.moneda };
  const moneda = String(l.moneda || cfg.moneda_defecto).toUpperCase();
  let reglas;
  try {
    // El precio del catálogo, sin descuento: es lo que cualquier gestora puede mandar.
    reglas = service.comprobarReglas({ cfg, prod, importe: Number(l.precio), moneda, esAdmin: false });
  } catch (err) {
    throw new SinLinkDePago(err.message);
  }
  try {
    const link = await service.crear({
      projectId: Number(l.project_id), leadId: l.id, conversionId: null,
      prod, reglas, importe: Number(l.precio), userId: Number(l.responsable_id),
    });
    await model.anotarEvento(link.id, 'desde_secuencia', { lead_id: l.id });
    return { link, nuevo: true };
  } catch (err) {
    logger.warn({ err: err.message, leadId }, 'Links de pago: no se pudo crear el link de la secuencia');
    throw new SinLinkDePago(err.message);
  }
}

/** El botón del correo, con lo que paga y hasta cuándo. */
export function bloque(link) {
  const curso = link.product_nombre || 'tu programa';
  return [
    P.boton({ texto: 'Pagar ahora', url: link.url }),
    P.nota(`${P.esc(curso)}: ${P.esc(dinero(link.importe, link.moneda))}.`
      + `${link.caduca_el ? ` El link caduca el ${P.esc(fecha(link.caduca_el))}.` : ''} El pago es seguro y lo procesa Stripe.`),
  ].join('\n');
}

/** El bloque de muestra de la vista previa (no crea nada). */
export function bloqueDeMuestra(curso = null) {
  return [
    P.boton({ texto: 'Pagar ahora', url: 'https://buy.stripe.com/' }),
    P.nota(`${P.esc(curso || 'El curso de interés del prospecto')}: el precio del catálogo. `
      + 'Al enviarse, el CRM pone aquí su link de pago (el que tenga vivo, o uno nuevo).'),
  ].join('\n');
}

/*
  Poner el bloque en un correo ya montado. `renderTemplate` escapa los valores, y
  `comoHtml` convierte el texto en párrafos solo si no trae etiquetas: el bloque
  se mete DESPUÉS de los dos, en el sitio de una marca de texto, para no romper
  ninguno. Si la marca quedó sola en su párrafo, el párrafo entero se cambia
  por el bloque.
*/
export const MARCA = 'ZZLINKDEPAGOZZ';
export const conMarca = (texto) => String(texto || '').replace(HUECO, MARCA);
export function ponerBloque(html, htmlDelBloque) {
  return String(html || '')
    .replace(new RegExp(`<p>\\s*${MARCA}\\s*</p>`, 'g'), htmlDelBloque)
    .split(MARCA).join(htmlDelBloque);
}
