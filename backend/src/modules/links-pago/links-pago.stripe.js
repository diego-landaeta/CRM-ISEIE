import { urlDeStripe } from '../../shared/config/stripeApi.js';

/*
  LAS LLAMADAS A STRIPE DE LOS LINKS DE PAGO (CRM#680, fase 2).

  Todo lo que escribe en Stripe desde el CRM pasa por aquí, con la clave de
  ESCRITURA del campus (`stripe_links`), nunca con la de lectura del sondeo.

  · Se crea primero un Price (con su producto en línea) y luego el Payment Link
    con ese Price. Se podría mandar el importe dentro del link (`price_data`),
    pero eso depende de la versión de la API de cada cuenta, y el CRM no fija
    versión: así funciona en todas.
  · Cada POST de creación lleva su `Idempotency-Key`: si la red se corta y se
    reintenta, Stripe devuelve lo mismo en vez de crear otro.
  · Los errores llevan el código HTTP y el mensaje de Stripe (sin la clave).
*/

/** `{a: {b: 1}, c: [x]}` → `a[b]=1&c[0]=x`, como lo quiere Stripe. */
export function aFormulario(obj, prefijo = '', partes = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const clave = prefijo ? `${prefijo}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        if (x !== null && typeof x === 'object') aFormulario(x, `${clave}[${i}]`, partes);
        else partes.push(`${encodeURIComponent(`${clave}[${i}]`)}=${encodeURIComponent(String(x))}`);
      });
    } else if (typeof v === 'object') {
      aFormulario(v, clave, partes);
    } else {
      partes.push(`${encodeURIComponent(clave)}=${encodeURIComponent(String(v))}`);
    }
  }
  return partes.join('&');
}

export class ErrorDeStripe extends Error {
  /**
   * `detalle`: lo que dice Stripe del error, sin la clave. Para un cobro
   * rechazado (402), `codigo` (`card_declined`, `authentication_required`…),
   * `motivo` (el `decline_code` del banco: `insufficient_funds`…) y el
   * PaymentIntent que quedó, si lo hay.
   */
  constructor(status, mensaje, detalle = {}) {
    super(mensaje);
    this.status = status;
    this.tipo = detalle.tipo || null;
    this.codigo = detalle.codigo || null;
    this.motivo = detalle.motivo || null;
    this.paymentIntentId = detalle.paymentIntentId || null;
  }
}

async function llamar(apiKey, metodo, ruta, { cuerpo = null, idempotencia = null } = {}) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const opciones = { method: metodo, headers };
  if (cuerpo) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opciones.body = aFormulario(cuerpo);
  }
  if (idempotencia) headers['Idempotency-Key'] = idempotencia;
  const r = await fetch(urlDeStripe(ruta), opciones);
  let datos = null;
  try { datos = await r.json(); } catch { datos = null; }
  if (!r.ok) {
    const e = datos?.error || {};
    const msg = e.message || `HTTP ${r.status}`;
    throw new ErrorDeStripe(r.status, `Stripe ${metodo} ${ruta.split('?')[0]}: ${msg}`, {
      tipo: e.type, codigo: e.code, motivo: e.decline_code,
      paymentIntentId: typeof e.payment_intent === 'string' ? e.payment_intent : e.payment_intent?.id,
    });
  }
  return datos;
}

/*
  Monedas sin decimales en Stripe: el importe va en unidades, no en céntimos.
  https://docs.stripe.com/currencies#zero-decimal
*/
const SIN_DECIMALES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

/** 123.45 EUR → 12345; 1500 CLP → 1500. Redondeado, sin coma flotante colada. */
export function enUnidadesMinimas(importe, moneda) {
  const n = Number(importe);
  if (SIN_DECIMALES.has(String(moneda).toUpperCase())) return Math.round(n);
  return Math.round(n * 100);
}

export const MENSAJE_INACTIVO = 'Este link de pago ya no está disponible. Pide uno nuevo a la persona que te atiende.';

/** El Price del link: el importe que se cobra, una sola vez. */
export function crearPrecio(apiKey, { importe, moneda, nombre, metadata, idempotencia }) {
  return llamar(apiKey, 'POST', '/v1/prices', {
    idempotencia,
    cuerpo: {
      currency: String(moneda).toLowerCase(),
      unit_amount: enUnidadesMinimas(importe, moneda),
      product_data: { name: String(nombre).slice(0, 250), metadata },
      metadata,
    },
  });
}

/**
 * El Payment Link. Un solo pago (`completed_sessions.limit = 1`) y la marca del
 * CRM en el link y en el cargo, para atar el cobro sin depender del correo
 * (fase 3).
 */
/*
 * `pedirTelefono` (link sin prospecto, 20/11): Checkout pide también el teléfono.
 * Con el correo y el nombre, es lo que usa el CRM para encontrar o crear el
 * prospecto al pagarse.
 */
export function crearLink(apiKey, { priceId, metadata, idempotencia, guardaTarjeta = null, pedirTelefono = false }) {
  return llamar(apiKey, 'POST', '/v1/payment_links', {
    idempotencia,
    cuerpo: {
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      payment_intent_data: {
        metadata,
        // Cobro automático de las cuotas (gemela de CRM 309): la tarjeta queda guardada
        // en un cliente de Stripe para cobrar solas las cuotas siguientes, sin el alumno
        // delante. Stripe pide el consentimiento: va en el texto del botón de pagar.
        ...(guardaTarjeta ? { setup_future_usage: 'off_session' } : {}),
      },
      ...(pedirTelefono ? { phone_number_collection: { enabled: true } } : {}),
      ...(guardaTarjeta ? {
        customer_creation: 'always',
        custom_text: { submit: { message: String(guardaTarjeta.consentimiento).slice(0, 1200) } },
      } : {}),
      ...(pedirTelefono ? { phone_number_collection: { enabled: true } } : {}),
      restrictions: { completed_sessions: { limit: 1 } },
      inactive_message: MENSAJE_INACTIVO,
    },
  });
}

/** Desactivar un link (caducado o anulado). Un link de Stripe no se borra. */
export function desactivarLink(apiKey, paymentLinkId) {
  return llamar(apiKey, 'POST', `/v1/payment_links/${encodeURIComponent(paymentLinkId)}`, {
    cuerpo: { active: false },
  });
}

// ─── El cobro automático de las cuotas (309): lo cobra Stripe ───────────────

/**
 * ¿La clave puede programar los cobros? Lee (no cambia nada) un Subscription
 * Schedule y una factura: si le faltan esos permisos, Stripe contesta 403 y el
 * cobro automático no se activa. Escribir no se puede comprobar sin escribir: si
 * tiene lectura y no escritura, lo dirá la primera vez que programe.
 */
export async function comprobarPermisosDeCobro(apiKey) {
  await llamar(apiKey, 'GET', '/v1/subscription_schedules?limit=1');
  await llamar(apiKey, 'GET', '/v1/invoices?limit=1');
}

/**
 * El precio de UNA cuota: recurrente cada `dias` días, que es lo que dura su fase.
 * Así, dentro de su fase Stripe cobra una sola vez (al empezar). Lleva la marca de
 * la cuota: es lo que ata la factura a su cuota cuando se cobra.
 */
export function crearPrecioDeCuota(apiKey, { importe, moneda, nombre, dias, metadata, idempotencia }) {
  return llamar(apiKey, 'POST', '/v1/prices', {
    idempotencia,
    cuerpo: {
      currency: String(moneda).toLowerCase(),
      unit_amount: enUnidadesMinimas(importe, moneda),
      recurring: { interval: 'day', interval_count: dias },
      product_data: { name: String(nombre).slice(0, 250), metadata },
      metadata,
    },
  });
}

/**
 * Las fases para Stripe: una por cuota, de su fecha a la de la siguiente, con su
 * precio y su marca. La primera factura de cada fase sale al empezar
 * (`billing_cycle_anchor: phase_start`) y nunca se prorratea.
 */
export function fasesParaStripe(fases) {
  return fases.map((f, i) => ({
    items: [{ price: f.priceId, quantity: 1 }],
    ...(i === 0 && f.inicio ? { start_date: f.inicio } : {}),
    end_date: f.fin,
    billing_cycle_anchor: 'phase_start',
    proration_behavior: 'none',
    metadata: f.metadata,
  }));
}

/** Crear el calendario de cobros: empieza en la fecha de la primera cuota y se cancela al acabar. */
export function crearCalendario(apiKey, { customerId, paymentMethodId, fases, metadata, idempotencia }) {
  return llamar(apiKey, 'POST', '/v1/subscription_schedules', {
    idempotencia,
    cuerpo: {
      customer: customerId,
      start_date: fases[0].inicio,
      end_behavior: 'cancel',
      default_settings: {
        default_payment_method: paymentMethodId,
        collection_method: 'charge_automatically',
      },
      metadata,
      phases: fasesParaStripe(fases),
    },
  });
}

export function verCalendario(apiKey, id) {
  return llamar(apiKey, 'GET', `/v1/subscription_schedules/${encodeURIComponent(id)}`);
}

/** Cambiar las fases (Stripe sustituye la lista entera: la fase en curso va la primera, tal cual). */
export function cambiarCalendario(apiKey, id, { fases, paymentMethodId }) {
  return llamar(apiKey, 'POST', `/v1/subscription_schedules/${encodeURIComponent(id)}`, {
    cuerpo: {
      end_behavior: 'cancel',
      proration_behavior: 'none',
      ...(paymentMethodId ? { default_settings: { default_payment_method: paymentMethodId } } : {}),
      phases: fasesParaStripe(fases),
    },
  });
}

/** Cancelar el calendario: no se cobra ninguna cuota más. */
export function cancelarCalendario(apiKey, id) {
  return llamar(apiKey, 'POST', `/v1/subscription_schedules/${encodeURIComponent(id)}/cancel`, {
    cuerpo: { invoice_now: false, prorate: false },
  });
}

/**
 * Tras un cobro fallido, Stripe NO reintenta por su cuenta (`auto_advance` a
 * false): sus reintentos son de la cuenta entera y pueden ser varios. El único
 * reintento lo pide el CRM a los días que diga el campus.
 */
export function pararReintentosDeStripe(apiKey, invoiceId) {
  return llamar(apiKey, 'POST', `/v1/invoices/${encodeURIComponent(invoiceId)}`, { cuerpo: { auto_advance: false } });
}

/** El reintento: cobrar otra vez esa factura con la tarjeta guardada. Una vez (misma clave). */
export function reintentarFactura(apiKey, invoiceId, { idempotencia }) {
  return llamar(apiKey, 'POST', `/v1/invoices/${encodeURIComponent(invoiceId)}/pay`, { idempotencia, cuerpo: { off_session: true } });
}

/** Una factura ya pagada por otro lado (el link de la cuota) no se cobra: se anula. */
export function anularFactura(apiKey, invoiceId) {
  return llamar(apiKey, 'POST', `/v1/invoices/${encodeURIComponent(invoiceId)}/void`, { cuerpo: {} });
}

export function verFactura(apiKey, invoiceId) {
  return llamar(apiKey, 'GET', `/v1/invoices/${encodeURIComponent(invoiceId)}`);
}

// ─── El webhook de la cuenta ────────────────────────────────────────────────

export function verWebhook(apiKey, endpointId) {
  return llamar(apiKey, 'GET', `/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`);
}

/**
 * Cambia los eventos o lo activa/desactiva. Stripe sustituye la lista de
 * eventos entera: quien llama manda la lista completa, no solo lo nuevo.
 */
export function actualizarWebhook(apiKey, endpointId, { eventos, desactivado }) {
  const cuerpo = {};
  if (eventos) cuerpo.enabled_events = eventos;
  if (desactivado !== undefined) cuerpo.disabled = desactivado;
  return llamar(apiKey, 'POST', `/v1/webhook_endpoints/${encodeURIComponent(endpointId)}`, { cuerpo });
}
