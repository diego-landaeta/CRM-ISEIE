import * as model from './links-pago.model.js';
import { planDelLink, hoyEnMadrid } from './links-pago.service.js';
import { buscarVentaRepetida, errorVentaYaExiste } from '../conversions/venta-repetida.js';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/*
  LA VENTA SE CREA AL CREAR EL LINK (CRM-ISEIE#762, gemela de CRM#1107; Diego, 24/11/2026).

  Hasta ahora, un link creado desde un prospecto no cambiaba nada: la venta se
  creaba (y el prospecto pasaba a «Convertido») cuando Stripe confirmaba el pago
  (`crearVentaDelLink` en links-pago.cobro.js). Diego quiere la venta desde el
  principio, pegada al link:

    · pago único: la venta por el importe del link, pendiente de cobro;
    · en cuotas: con su plan (inicial + N cuotas con sus fechas) y, si el link
      guarda la tarjeta, con el cobro automático marcado;
    · a nombre de quien crea el link (`vendedora_id`), y el prospecto pasa a
      «Convertido», como al registrarla a mano (`createSale`);
    · el link queda atado a la venta (`conversion_id`) y, al pagarse, el cobro va
      a ella por el camino de siempre de los links que salen de una venta: ni otra
      venta ni otro cobro.

  ANTES DE TOCAR STRIPE (`ventaParaElLink`):
    · si la ficha ya tiene una venta de ese curso con lo pendiente para cubrir el
      link (pago único), el link va a esa;
    · si no, la comprobación de «venta repetida» (CRM#898): 409 VENTA_YA_EXISTE
      con la venta que hay, y la gestora elige (atar el link a esa venta o crear
      otra igualmente, `forzar`).

  QUÉ NO CAMBIA:
    · un link sin prospecto (solo el campus) sigue creando ficha y venta al
      pagarse: no hay a quién ponerle la venta;
    · un link en otra moneda, tampoco: el CRM guarda las ventas en euros y lo que
      vale en euros no se sabe hasta que entra el cobro;
    · si crear la venta falla, el link ya existe y vale: su venta se crea al
      pagarse, como antes. No se deja a nadie sin poder pagar.

  SI EL LINK CADUCA O SE ANULA SIN PAGARSE (decisión de Diego, 24/11): la venta
  se queda como está, pendiente, y se avisa a quien creó el link (campana y un
  recordatorio de hoy, que sale en «Tu día»). Ella decide: un link nuevo,
  registrar el pago si pagó por otra vía, o anular la venta. Nada automático.
*/

const TIPO_EVENTO = 'venta_del_link';

/** ¿Este link lleva su venta desde que se crea? Desde un prospecto, sin venta y en euros. */
export function llevaVentaAlCrear({ leadId, conversionId, modalidad, moneda }) {
  if (!leadId || conversionId) return false;
  return modalidad === 'cuotas' || String(moneda || 'EUR').toUpperCase() === 'EUR';
}

/**
 * A qué venta irá el link, ANTES de crearlo en Stripe:
 *   · `{ conversionId }`: la de ese curso que ya tiene la ficha (pago único, con lo
 *     pendiente suficiente para el link);
 *   · `{ crear: true }`: una nueva, que se crea al crear el link.
 * Lanza 409 VENTA_YA_EXISTE si el alumno ya tiene una venta de ese programa y no
 * se pide `forzar`.
 */
export async function ventaParaElLink({ projectId, leadId, productId, importe, modalidad, forzar = false, reusar = true }) {
  if (modalidad !== 'cuotas' && reusar) {
    const ya = await model.ventaDelCursoEnLaFicha(leadId, productId);
    if (ya) {
      const pendiente = await model.pendienteDeVenta(ya.id);
      if (pendiente > 0 && Math.round(Number(importe) * 100) <= Math.round(pendiente * 100)) {
        return { conversionId: Number(ya.id), creada: false };
      }
    }
  }
  if (!forzar) {
    const repetida = await buscarVentaRepetida({ projectId, productoId: productId, leadId });
    if (repetida) throw errorVentaYaExiste(repetida);
  }
  return { crear: true };
}

/** Las notas con las que nace la venta de un link (y por las que se reconoce). */
export const notasDeLaVentaAlCrear = (linkId) =>
  `Venta creada por el CRM al crear el link de pago n.º ${linkId}. Pendiente de cobro hasta que se pague.`;

/**
 * La venta nueva del link, recién creado este en Stripe. Devuelve
 * `{ conversionId, creada: true }` o `{ error }` (el link sigue valiendo: su venta
 * se creará al pagarse). Nunca lanza.
 */
export async function crearVentaDelLink(linkId, { userId, role = 'gestor', forzar = false }) {
  const l = await model.paraCobro(linkId);
  if (!l?.lead_id) return { error: 'El link no tiene prospecto.' };
  const hoy = hoyEnMadrid();
  const cuotas = planDelLink(l, hoy);
  try {
    const { createSale } = await import('../sales/sales.service.js');
    const venta = await createSale({
      project_id: Number(l.project_id),
      lead_id: Number(l.lead_id),
      producto_interes_id: l.product_id ? Number(l.product_id) : undefined,
      importe_total: Number(l.importe),
      importe_pagado: 0,
      metodo_pago: cuotas ? 'fraccionado' : 'tarjeta',
      ...(cuotas ? { installments: cuotas.map((c) => ({ importe_previsto: c.importe, fecha_vencimiento: c.vence })) } : {}),
      fecha_pago: hoy,
      vendedora_id: Number(userId),
      // El importe del link es el precio final, IVA dentro: aquí, sin esto, se sumaría el 21 %.
      iva_incluido: true,
      notas: notasDeLaVentaAlCrear(l.id),
      ...(forzar ? { forzar: true } : {}),
    }, { userId: Number(userId), role });
    const conversionId = Number(venta.conversion_id);
    await model.ponerVenta(l.id, conversionId, l.lead_id);
    // El pago único se espera hasta que caduca el link, no desde hoy.
    if (!cuotas) await model.compromisoHastaLaCaducidad(conversionId, l.id).catch(() => {});
    // El precio original y el descuento del link (CRM#982). Si no se pudiera
    // apuntar, la venta sigue bien: su total es el del link.
    await model.descuentoEnLaVenta(conversionId, l).catch((e) => logger.warn({ err: e.message, linkId: l.id },
      'links de pago: no se pudo apuntar el descuento del link en la venta'));
    // Con cobro automático (el link guarda la tarjeta), marcado en la venta: al
    // pagarse el link se guarda la tarjeta y Stripe programa las demás cuotas.
    if (cuotas && l.guarda_tarjeta) {
      const cobroAutoModel = await import('./links-pago.cobro-auto.model.js');
      await cobroAutoModel.poner(conversionId, { projectId: Number(l.project_id), activo: true, userId: Number(userId) });
    }
    await model.anotarEvento(l.id, TIPO_EVENTO, { conversion_id: conversionId, creada: true, por: Number(userId), cuotas: cuotas?.length || null });
    logger.info({ linkId: l.id, conversionId, userId, cuotas: cuotas?.length || null }, 'links de pago: venta creada al crear el link');
    return { conversionId, creada: true };
  } catch (err) {
    logger.warn({ linkId: l.id, err: err.message, code: err.code }, 'links de pago: no se pudo crear la venta al crear el link; se creará al pagarse');
    await model.anotarEvento(l.id, 'venta_no_creada', { motivo: err.message, code: err.code || null }).catch(() => {});
    return { error: err.message };
  }
}

/** El link va a la venta que ya tenía la ficha: queda dicho en su historial. */
export async function anotarVentaUsada(linkId, conversionId, userId) {
  await model.anotarEvento(linkId, TIPO_EVENTO, { conversion_id: Number(conversionId), creada: false, por: Number(userId) });
}

// ─── Caducado o anulado sin pagar: aviso a quien lo creó ────────────────────

/** Lo que hace falta para avisar: el link, su venta (con lo pendiente) y si salió de este camino. */
async function paraAvisar(linkId) {
  const { COBRADO_DE } = await import('../conversions/cobrado.js');
  const { rows } = await query(
    `SELECT pl.id, pl.project_id, pl.lead_id, pl.conversion_id, pl.created_by, pl.estado, pl.installment_id,
            pl.importe::float8 AS importe, pl.moneda, l.nombre AS lead_nombre, pr.nombre AS producto_nombre,
            GREATEST(c.importe_total - ${COBRADO_DE('c')}, 0)::float8 AS pendiente,
            EXISTS (SELECT 1 FROM payment_link_eventos e
                     WHERE e.tipo = $2 AND e.link_id IN (pl.id, pl.renovado_de)) AS del_link,
            EXISTS (SELECT 1 FROM payment_links o
                     WHERE o.conversion_id = pl.conversion_id AND o.id <> pl.id
                       AND o.estado IN ('creado', 'abierto') AND o.installment_id IS NULL) AS otro_vivo
       FROM payment_links pl
       JOIN conversions c ON c.id = pl.conversion_id
       LEFT JOIN leads l ON l.id = pl.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE pl.id = $1`,
    [linkId, TIPO_EVENTO]);
  return rows[0] || null;
}

const euros = (n) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** El aviso de la campana y la nota del recordatorio. */
export function textosDelAviso(l, motivo) {
  const que = motivo === 'anulado' ? 'anulado' : 'caducado';
  const quien = l.lead_nombre || 'tu cliente';
  return {
    title: `Link de pago ${que} sin pagar: ${quien}`,
    message: `La venta n.º ${l.conversion_id}${l.producto_nombre ? ` (${l.producto_nombre})` : ''} sigue pendiente: `
      + `${euros(l.pendiente)} €. Decide tú: genera un link nuevo, registra el pago si pagó por otra vía o anula la venta.`,
    nota: `Link de pago n.º ${l.id} ${que} sin pagar. La venta n.º ${l.conversion_id} sigue pendiente (${euros(l.pendiente)} €): `
      + 'genera un link nuevo, registra el pago si pagó por otra vía o anula la venta.',
  };
}

/**
 * Un link que se ha caducado o anulado sin pagarse. Si es de los que llevan su
 * venta desde que se crean (o renueva uno de ellos), la venta sigue pendiente y
 * no hay otro link vivo para ella, se avisa a quien lo creó: en la campana y con
 * un recordatorio de hoy en su ficha («Tu día»). La venta no se toca. Una vez por
 * link. Nunca lanza.
 */
export async function avisarSinPagar(linkId, motivo) {
  try {
    const l = await paraAvisar(linkId);
    if (!l || !l.del_link || l.installment_id || l.otro_vivo) return null;
    if (!['caducado', 'anulado'].includes(l.estado) || !(Number(l.pendiente) > 0.005)) return null;
    const { rows: ya } = await query(
      'SELECT 1 FROM payment_link_eventos WHERE link_id = $1 AND tipo = $2 LIMIT 1', [l.id, 'aviso_sin_pagar']);
    if (ya.length) return null;
    if (!l.created_by) {
      await model.anotarEvento(l.id, 'aviso_sin_pagar', { motivo, sin_destinatario: true });
      return null;
    }
    const t = textosDelAviso(l, motivo);
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    await notifyUsers({
      targetUserIds: [Number(l.created_by)],
      type: 'link_pago_sin_pagar',
      title: t.title,
      message: t.message,
      link_path: l.lead_id ? `/prospectos/${l.lead_id}` : '/links-pago',
      metadata: { payment_link_id: l.id, conversion_id: l.conversion_id, lead_id: l.lead_id, motivo },
    });
    // El recordatorio de hoy, para quien creó el link: sale en «Tu día» (Dashboard y
    // correo de la noche). Ya avisado por la campana: no lo repite el de recordatorios.
    let reminderId = null;
    if (l.lead_id) {
      const { rows } = await query(
        `INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, created_by, notificado_at)
         VALUES ($1, (NOW() AT TIME ZONE 'Europe/Madrid')::date, $2, $3, NOW()) RETURNING id`,
        [l.lead_id, t.nota, Number(l.created_by)]);
      reminderId = rows[0]?.id ?? null;
    }
    await model.anotarEvento(l.id, 'aviso_sin_pagar', { motivo, a: Number(l.created_by), conversion_id: l.conversion_id, reminder_id: reminderId });
    logger.info({ linkId: l.id, conversionId: l.conversion_id, a: l.created_by, motivo }, 'links de pago: aviso de link sin pagar con la venta pendiente');
    return { avisado: Number(l.created_by), reminderId };
  } catch (err) {
    logger.warn({ err: err.message, linkId, motivo }, 'links de pago: no se pudo avisar del link sin pagar');
    return null;
  }
}
