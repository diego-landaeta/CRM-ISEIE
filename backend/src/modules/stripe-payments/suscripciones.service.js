/**
 * VENTAS A PLAZOS: LA SUSCRIPCIÓN DE STRIPE SE CIERRA SOLA AL COMPLETAR EL PAGO (#747).
 *
 * Manuel, 12/11/2026: «si nadie cancela la suscripción a tiempo se cobra una
 * cuota de más. Ya ha pasado».
 *
 * Tres piezas:
 *
 *   1. apuntarSuscripcion: cuando un cargo de Stripe queda asociado a una venta,
 *      se pregunta a Stripe de qué suscripción viene (cargo → factura →
 *      suscripción) y se guarda en la venta. Un cargo suelto, sin suscripción, no
 *      hace nada. Cada cargo se pregunta una sola vez.
 *
 *   2. revisarVenta: si la venta tiene suscripción abierta y lo COBRADO (cobros
 *      registrados menos devoluciones, nunca cuotas emitidas) llega a su total, se
 *      cancela la suscripción en Stripe y se avisa. Una cuota que falla no es un
 *      cobro: no entra en la cuenta y la suscripción sigue.
 *
 *   3. Avisos: a admisión del campus (las direcciones del webhook de admisión,
 *      Matrículas → Webhooks) y a SUSCRIPCION_AVISO_PARA (Manuel). Sin el nombre
 *      de la alumna, por la misma regla que el aviso de admisión (#714): los
 *      buzones compartidos no llevan datos personales; el botón abre su ficha.
 *
 * Cautelas, porque aquí se deja de cobrar a alguien:
 *   · Si quedan cuotas PREVISTAS sin cobrar en la venta, no se cancela aunque lo
 *     cobrado llegue al total: el total puede estar mal puesto. Se marca
 *     «revisar» y se avisa una vez para que lo mire una persona.
 *   · Una sola cancelación por venta: la venta se reserva con una sentencia
 *     (estado «cerrando») antes de llamar a Stripe.
 *   · Si Stripe no deja cancelarla (clave de solo lectura, red…), se marca
 *     «error» y se avisa para cancelarla a mano. Se reintenta en la siguiente
 *     vuelta, pero el aviso sale una vez.
 *   · Con interruptor: SUSCRIPCION_CIERRE_ACTIVO=true. Apagado, la suscripción se
 *     apunta igual y lo que se haría queda en el registro, pero no se cancela.
 */
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { urlDeStripe } from '../../shared/config/stripeApi.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import * as P from '../../shared/services/email-plantilla.service.js';

export const cierreActivo = (env = process.env) => {
  const v = String(env.SUSCRIPCION_CIERRE_ACTIVO || '').toLowerCase();
  return v === 'true' || v === '1';
};

// Un céntimo de margen: los importes vienen de euros con decimales.
const MARGEN = 0.01;

// ── Stripe ──────────────────────────────────────────────────────────────────

/**
 * La clave del campus. Para CANCELAR hace falta la de escritura (la de los links
 * de pago, #680); si no hay, se prueba con la normal, que en algunos campus es
 * secreta y en otros restringida de solo lectura (y entonces Stripe dice 403).
 */
export async function claveDeStripe(projectId, { escritura = false } = {}) {
  const proveedores = escritura ? ['stripe_links', 'stripe'] : ['stripe'];
  for (const p of proveedores) {
    try {
      const row = await integrationsModel.get(projectId, p);
      if (row?.encrypted_value) return decrypt(row.encrypted_value, row.iv, row.auth_tag);
    } catch (e) { logger.warn({ err: e.message, projectId, proveedor: p }, 'suscripción: no se pudo leer la clave de Stripe'); }
  }
  return process.env.STRIPE_SECRET_KEY || null;
}

async function stripe(apiKey, metodo, path, params = null) {
  const url = new URL(urlDeStripe(path));
  if (params && metodo === 'GET') for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url, { method: metodo, headers: { Authorization: `Bearer ${apiKey}` } });
  if (!r.ok) {
    const e = new Error(`Stripe ${metodo} ${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

const idDe = (x) => (x && typeof x === 'object' ? x.id : x) || null;

/**
 * La suscripción de una factura. Stripe la ha movido de sitio entre versiones de
 * la API: `subscription` en las de siempre, `parent.subscription_details` desde
 * 2025. Se miran las dos, y las líneas por si acaso.
 */
export function suscripcionDeFactura(inv) {
  if (!inv) return null;
  return idDe(inv.subscription)
    || idDe(inv.parent?.subscription_details?.subscription)
    || idDe(inv.lines?.data?.find((l) => l.subscription)?.subscription)
    || idDe(inv.lines?.data?.find((l) => l.parent?.subscription_item_details?.subscription)?.parent?.subscription_item_details?.subscription)
    || null;
}

/**
 * De qué suscripción viene un cargo: cargo → factura → suscripción. Las versiones
 * nuevas de la API ya no ponen la factura en el cargo; entonces se busca por su
 * PaymentIntent en los pagos de facturas. Sin factura, el cargo no es de una
 * suscripción (un pago único) y se devuelve null.
 */
export async function suscripcionDelCargo(apiKey, chargeId, { llamar = stripe } = {}) {
  const ch = await llamar(apiKey, 'GET', `/v1/charges/${chargeId}`);
  let factura = idDe(ch.invoice);
  if (!factura && ch.payment_intent) {
    try {
      const pagos = await llamar(apiKey, 'GET', '/v1/invoice_payments', {
        'payment[type]': 'payment_intent', 'payment[payment_intent]': idDe(ch.payment_intent), limit: 1,
      });
      factura = idDe(pagos?.data?.[0]?.invoice);
    } catch (e) {
      // Una cuenta con la API antigua no tiene /v1/invoice_payments: sin factura en
      // el cargo, ahí no hay suscripción.
      if (e.status !== 404) throw e;
    }
  }
  if (!factura) return null;
  const inv = typeof ch.invoice === 'object' && ch.invoice ? ch.invoice : await llamar(apiKey, 'GET', `/v1/invoices/${factura}`);
  return suscripcionDeFactura(inv);
}

// ── 1. Apuntar la suscripción de la venta ───────────────────────────────────

/**
 * Tras asociar un cargo a una venta. Pregunta UNA vez por cargo; si viene de una
 * suscripción, la deja en el cargo y en la venta (la primera que se vea: una
 * venta es una suscripción).
 */
export async function apuntarSuscripcion(stripePaymentId, { clave = claveDeStripe, delCargo = suscripcionDelCargo } = {}) {
  const { rows: [sp] } = await query(
    `SELECT id, project_id, stripe_id, conversion_id, status, suscripcion_buscada
       FROM stripe_payments WHERE id = $1`, [stripePaymentId]);
  if (!sp?.conversion_id || sp.suscripcion_buscada || sp.status !== 'succeeded') return null;
  const apiKey = await clave(sp.project_id);
  if (!apiKey) return null;
  const sub = await delCargo(apiKey, sp.stripe_id);
  await query(
    `UPDATE stripe_payments SET stripe_subscription_id = $2, suscripcion_buscada = true WHERE id = $1`,
    [sp.id, sub]);
  if (!sub) return null;
  const { rows: [v] } = await query(
    `UPDATE conversions
        SET stripe_subscription_id = COALESCE(stripe_subscription_id, $2),
            suscripcion_estado = COALESCE(suscripcion_estado, 'activa')
      WHERE id = $1
      RETURNING stripe_subscription_id`, [sp.conversion_id, sub]);
  if (v && v.stripe_subscription_id !== sub) {
    logger.warn({ conversionId: sp.conversion_id, tiene: v.stripe_subscription_id, cargo: sub },
      'suscripción: la venta ya tenía otra suscripción; se deja la primera');
  }
  return sub;
}

// ── 2. Revisar la venta y cerrar la suscripción ─────────────────────────────

async function datosDeLaVenta(conversionId) {
  const { rows: [v] } = await query(
    `SELECT c.id, c.project_id, c.lead_id, c.importe_total, c.producto_contratado,
            c.stripe_subscription_id, c.suscripcion_estado, c.suscripcion_cerrada_at,
            p.nombre AS campus, p.slug, p.logo_url, p.emoji,
            COALESCE((SELECT SUM(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = c.id), 0)
              - COALESCE((SELECT SUM(r.importe) FROM conversion_refunds r WHERE r.conversion_id = c.id), 0) AS cobrado,
            (SELECT COUNT(*) FROM conversion_payments cp WHERE cp.conversion_id = c.id)::int AS cobros,
            (SELECT COUNT(*) FROM conversion_installments i WHERE i.conversion_id = c.id AND i.fecha_cobro IS NULL)::int AS cuotas_pendientes
       FROM conversions c
       LEFT JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1`, [conversionId]);
  return v || null;
}

/** Lo que toca hacer con la venta, sin tocar nada. Aparte para probarlo. */
export function decidir(v) {
  if (!v?.stripe_subscription_id) return 'sin_suscripcion';
  if (v.suscripcion_cerrada_at) return 'ya_cerrada';
  const total = Number(v.importe_total) || 0;
  if (total <= 0) return 'sin_total';
  if (Number(v.cobrado) + MARGEN < total) return 'falta';
  if (Number(v.cuotas_pendientes) > 0) return 'revisar';
  return 'cerrar';
}

/**
 * Revisa una venta y, si ya está pagada entera, cancela su suscripción. No lanza:
 * devuelve lo que pasó.
 */
export async function revisarVenta(conversionId, {
  activo = cierreActivo, clave = claveDeStripe, llamar = stripe, avisar = avisarCierre,
} = {}) {
  const v = await datosDeLaVenta(conversionId);
  const decision = decidir(v);
  if (decision === 'sin_suscripcion' || decision === 'ya_cerrada' || decision === 'sin_total' || decision === 'falta') {
    return { resultado: decision };
  }

  if (decision === 'revisar') {
    // Una vez: solo al pasar a «revisar».
    const { rows } = await query(
      `UPDATE conversions SET suscripcion_estado = 'revisar', suscripcion_revisada_at = NOW()
        WHERE id = $1 AND suscripcion_estado IS DISTINCT FROM 'revisar' RETURNING id`, [v.id]);
    if (rows.length && activo()) await avisar(v, 'revisar');
    return { resultado: 'revisar' };
  }

  if (!activo()) {
    logger.info({ conversionId: v.id, suscripcion: v.stripe_subscription_id, cobrado: Number(v.cobrado), total: Number(v.importe_total) },
      'suscripción: la venta está pagada; se cancelaría (SUSCRIPCION_CIERRE_ACTIVO apagado)');
    return { resultado: 'apagado' };
  }

  // La reserva: una sola cancelación por venta aunque lleguen dos avisos a la vez.
  const { rows: [reservada] } = await query(
    `UPDATE conversions SET suscripcion_estado = 'cerrando', suscripcion_revisada_at = NOW()
      WHERE id = $1 AND suscripcion_cerrada_at IS NULL
        AND (suscripcion_estado IS DISTINCT FROM 'cerrando' OR suscripcion_revisada_at < NOW() - INTERVAL '5 minutes')
      RETURNING suscripcion_estado`, [v.id]);
  if (!reservada) return { resultado: 'en_curso' };

  const sub = v.stripe_subscription_id;
  try {
    const apiKey = await clave(v.project_id, { escritura: true });
    if (!apiKey) throw new Error('el campus no tiene clave de Stripe');
    const actual = await llamar(apiKey, 'GET', `/v1/subscriptions/${sub}`);
    if (['canceled', 'incomplete_expired'].includes(actual?.status)) {
      await query(
        `UPDATE conversions SET suscripcion_estado = 'ya_cerrada', suscripcion_cerrada_at = NOW(), suscripcion_error = NULL WHERE id = $1`, [v.id]);
      logger.info({ conversionId: v.id, suscripcion: sub }, 'suscripción: ya estaba cerrada en Stripe');
      return { resultado: 'ya_cerrada_en_stripe' };
    }
    await llamar(apiKey, 'DELETE', `/v1/subscriptions/${sub}`);
    await query(
      `UPDATE conversions SET suscripcion_estado = 'cancelada', suscripcion_cerrada_at = NOW(), suscripcion_error = NULL WHERE id = $1`, [v.id]);
    logger.info({ conversionId: v.id, suscripcion: sub, cobrado: Number(v.cobrado), total: Number(v.importe_total) },
      'suscripción: pago completado, cancelada en Stripe');
    await avisar(v, 'cancelada');
    return { resultado: 'cancelada' };
  } catch (err) {
    const { rows: [antes] } = await query(
      `UPDATE conversions c SET suscripcion_estado = 'error', suscripcion_error = $2
         FROM (SELECT id, suscripcion_error FROM conversions WHERE id = $1) a
        WHERE c.id = a.id
        RETURNING a.suscripcion_error AS error_antes`, [v.id, String(err.message).slice(0, 500)]);
    logger.error({ conversionId: v.id, suscripcion: sub, err: err.message }, 'suscripción: no se pudo cancelar');
    // El aviso de «cancélala a mano», una vez: si ya había un error apuntado, ya se avisó.
    if (!antes?.error_antes) await avisar(v, 'error', err.message);
    return { resultado: 'error', error: err.message };
  }
}

/** Tras asociar un cargo: apunta su suscripción y revisa la venta. No lanza nunca. */
export async function trasAsociarCargo(stripePaymentId) {
  try {
    // Barato a propósito: se llama con cada cargo del sondeo. Un cargo sin venta,
    // o ya mirado y de una venta sin suscripción, no hace nada más.
    const leer = () => query(
      `SELECT sp.conversion_id, sp.suscripcion_buscada, c.stripe_subscription_id, c.suscripcion_cerrada_at
         FROM stripe_payments sp LEFT JOIN conversions c ON c.id = sp.conversion_id
        WHERE sp.id = $1`, [stripePaymentId]).then((r) => r.rows[0]);
    let sp = await leer();
    if (!sp?.conversion_id) return null;
    if (!sp.suscripcion_buscada) { await apuntarSuscripcion(stripePaymentId); sp = await leer(); }
    if (sp?.stripe_subscription_id && !sp.suscripcion_cerrada_at) return await revisarVenta(sp.conversion_id);
  } catch (err) {
    logger.error({ stripePaymentId, err: err.message }, 'suscripción: no se pudo revisar tras asociar el cargo');
  }
  return null;
}

// ── 3. Avisos ───────────────────────────────────────────────────────────────

const limpiar = (lista) => {
  const vistos = new Set();
  for (const d of lista) {
    const e = String(d || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) vistos.add(e);
  }
  return [...vistos];
};

/** Admisión del campus (webhook de admisión) y SUSCRIPCION_AVISO_PARA. */
export async function destinatarios(projectId, env = process.env) {
  const { rows } = await query(
    `SELECT aviso_emails FROM project_webhook_tokens WHERE project_id = $1 AND kind = 'matriculas'`, [projectId]);
  const admision = rows.flatMap((r) => r.aviso_emails || []);
  const extra = String(env.SUSCRIPCION_AVISO_PARA || '').split(/[,;\s]+/);
  return limpiar([...admision, ...extra]);
}

const euros = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** El correo, armado. Aparte del envío para probarlo sin Brevo. */
export function armarAviso(v, tipo, detalle = null) {
  const campus = v.campus || 'el campus';
  const curso = String(v.producto_contratado || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const textos = {
    cancelada: {
      titulo: 'Pago completado: suscripción cerrada',
      resumen: `Una alumna de ${campus} ha terminado de pagar y su suscripción de Stripe está cancelada.`,
      cuerpo: `Una alumna de <strong>${P.esc(campus)}</strong>${curso ? ` (${P.esc(curso)})` : ''} ha completado el pago de su venta a plazos. El CRM ha <strong>cancelado su suscripción en Stripe</strong>: no se le cobrará ninguna cuota más.`,
    },
    error: {
      titulo: 'URGENTE: cancela a mano una suscripción de Stripe',
      resumen: `Una alumna de ${campus} ha terminado de pagar, pero Stripe no ha dejado cancelar su suscripción.`,
      cuerpo: `Una alumna de <strong>${P.esc(campus)}</strong>${curso ? ` (${P.esc(curso)})` : ''} ha completado el pago, pero <strong>Stripe no ha dejado cancelar su suscripción</strong>. Cancélala a mano en Stripe hoy, o se le cobrará otra cuota.`,
    },
    revisar: {
      titulo: 'Revisa una venta a plazos antes de cerrar su suscripción',
      resumen: `Lo cobrado ya llega al total de una venta de ${campus}, pero tiene cuotas previstas sin cobrar.`,
      cuerpo: `En una venta de <strong>${P.esc(campus)}</strong>${curso ? ` (${P.esc(curso)})` : ''}, lo cobrado ya llega al total, pero quedan <strong>${P.esc(String(v.cuotas_pendientes))} cuota(s) previstas sin cobrar</strong>. El CRM no cancela la suscripción por si el total está mal puesto. Revisa la venta: si está pagada, borra las cuotas que sobran y la suscripción se cerrará sola.`,
    },
  }[tipo];
  const bloques = [
    P.parrafo(textos.cuerpo),
    P.tarjetas([
      { etiqueta: 'Total de la venta', valor: euros(v.importe_total) },
      { etiqueta: 'Cobrado', valor: euros(v.cobrado) },
      { etiqueta: 'Cobros', valor: String(v.cobros ?? '') },
    ]),
    P.nota(`Venta nº <strong>${P.esc(String(v.id))}</strong> · suscripción <strong>${P.esc(String(v.stripe_subscription_id))}</strong>${detalle ? `<br>Stripe respondió: ${P.esc(String(detalle).slice(0, 200))}` : ''}`),
    v.lead_id ? P.boton({ texto: 'Abrir la ficha', url: P.enlace(`clientes/${encodeURIComponent(v.lead_id)}`) }) : '',
    P.parrafo('<span style="font-size:13px;color:#71717a">Por protección de datos este aviso no lleva el nombre de la alumna: está en su ficha, en el CRM.</span>'),
  ];
  const { htmlContent, textContent } = P.correo({
    proyecto: { id: v.project_id, nombre: v.campus, slug: v.slug, logo_url: v.logo_url, emoji: v.emoji },
    titulo: textos.titulo,
    resumen: textos.resumen,
    bloques,
  });
  return { asunto: `${textos.titulo} · ${campus}`, htmlContent, textContent };
}

export async function avisarCierre(v, tipo, detalle = null) {
  try {
    const para = await destinatarios(v.project_id);
    if (!para.length) {
      logger.warn({ conversionId: v.id, tipo }, 'suscripción: no hay a quién avisar (ni webhook de admisión ni SUSCRIPCION_AVISO_PARA)');
      return { enviado: false, motivo: 'SIN_DESTINATARIOS' };
    }
    const c = armarAviso(v, tipo, detalle);
    const { sendEmail } = await import('../../shared/services/brevo.service.js');
    const r = await sendEmail({
      to: para.map((email) => ({ email })),
      subject: c.asunto,
      htmlContent: c.htmlContent,
      textContent: c.textContent,
      tags: ['suscripcion', `suscripcion-${tipo}`],
      clave: `suscripcion-${tipo}-${v.id}`,
      projectId: v.project_id,
    });
    return { enviado: !!r?.sent, motivo: r?.reason || null };
  } catch (err) {
    logger.warn({ err: err.message, conversionId: v.id, tipo }, 'suscripción: el aviso por correo falló');
    return { enviado: false, motivo: 'ERROR' };
  }
}

// ── La vuelta periódica ─────────────────────────────────────────────────────

/**
 * Lo que no llega por un cargo nuevo:
 *   · cargos ya asociados de los últimos 120 días cuya suscripción no se ha
 *     buscado (las suscripciones que ya estaban en marcha al estrenar esto);
 *   · ventas con suscripción abierta, por si el último cobro se apuntó a mano.
 */
export async function vuelta({ lote = 60 } = {}) {
  const { rows: cargos } = await query(
    `SELECT id FROM stripe_payments
      WHERE conversion_id IS NOT NULL AND NOT suscripcion_buscada AND status = 'succeeded'
        AND stripe_created_at > NOW() - INTERVAL '120 days'
      ORDER BY stripe_created_at DESC LIMIT $1`, [lote]);
  let apuntadas = 0;
  for (const c of cargos) {
    try { if (await apuntarSuscripcion(c.id)) apuntadas += 1; }
    catch (err) { logger.warn({ stripePaymentId: c.id, err: err.message }, 'suscripción: no se pudo buscar la del cargo'); }
  }
  const { rows: ventas } = await query(
    `SELECT id FROM conversions
      WHERE stripe_subscription_id IS NOT NULL AND suscripcion_cerrada_at IS NULL`);
  const resultados = {};
  for (const v of ventas) {
    const r = await revisarVenta(v.id).catch((err) => ({ resultado: 'error', error: err.message }));
    resultados[r.resultado] = (resultados[r.resultado] || 0) + 1;
  }
  return { cargosMirados: cargos.length, apuntadas, ventasAbiertas: ventas.length, ...resultados };
}
