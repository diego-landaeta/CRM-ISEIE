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
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
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
    const msg = datos?.error?.message || `HTTP ${r.status}`;
    throw new ErrorDeStripe(r.status, `Stripe ${metodo} ${ruta.split('?')[0]}: ${msg}`);
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
export function crearLink(apiKey, { priceId, metadata, idempotencia }) {
  return llamar(apiKey, 'POST', '/v1/payment_links', {
    idempotencia,
    cuerpo: {
      line_items: [{ price: priceId, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
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
