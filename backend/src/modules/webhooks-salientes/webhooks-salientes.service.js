import crypto from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';
import * as model from './webhooks-salientes.model.js';
import { comprobarDestino } from './webhooks-salientes.red.js';
import { METODOS_QUE_DISPARAN, EVENTO_DE } from './webhooks-salientes.validation.js';

/*
  WEBHOOK DE TRANSFERENCIAS: QUÉ SE MANDA, CÓMO Y CUÁNTAS VECES.

  Diego, 15/10: «un apartado en Conexión para enviar esos datos ÚNICAMENTE
  CUANDO SE PONGA DATOS POR TRANSFERENCIA BANCARIA / DEPÓSITO BANCARIO».

  CUÁNDO. Cuando se apunta un COBRO (`conversion_payments`) con forma de pago
  transferencia o depósito. Todos los caminos que apuntan un cobro pasan por
  `dispararCobro` —el alta de la venta con su primer pago, el abono, la proforma
  «Cobrada», la cuota cobrada y la edición de una cuota que pasa A transferencia—,
  y la forma de pago se lee de la base, no de quien llama: si no es una de esas
  dos, no sale nada. Con tarjeta, Stripe, efectivo, Bizum o PayPal, nunca.

  Una venta dada de alta con forma de pago «transferencia» pero SIN nada pagado
  no dispara: ahí aún no ha entrado dinero, es lo que el cliente promete. El
  aviso sale cuando la transferencia llega y alguien la apunta como cobro.

  DESPUÉS DEL COMMIT Y SIN ESPERAR. Como la factura automática y las comisiones:
  quien registra el cobro tiene su respuesta en seguida y el envío va por detrás.
  Si falla, el cobro sigue apuntado; el envío se reintenta solo.

  SIN DUPLICADOS. Una fila por cobro y webhook (`cobro-<id>-webhook-<id>`, única
  en la base). Volver a disparar, o editar el cobro, no manda otra. Un cambio de
  IMPORTE en un cobro ya enviado tampoco: lo que se avisó es que entró una
  transferencia, y eso no ha cambiado. Quien recibe tiene el id del cobro.

  REINTENTOS. El primer envío y hasta tres reintentos, a 1, 5 y 15 minutos. Se
  reintentan los cortes de red, los 5xx, el 408 y el 429; otro 4xx es que el
  destino no lo quiere y no va a cambiar de opinión, así que se da por fallido
  (desde la pantalla se puede reenviar a mano). La cola vive en la base: un
  reinicio no pierde nada.
*/

export { METODOS_QUE_DISPARAN, EVENTO_DE };

/** El primer envío y tres reintentos. */
export const MAX_INTENTOS = 4;
/** Lo que se espera tras el 1.º, 2.º y 3.er fallo. */
export const ESPERAS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const TIMEOUT_MS = parseInt(process.env.WEBHOOKS_SALIENTES_TIMEOUT_MS || '10000', 10);
const RESPUESTA_MAX = 1000;

export const claveDeIdempotencia = (paymentId, webhookId) => `cobro-${paymentId}-webhook-${webhookId}`;

/** `sha256=<hex>`: HMAC-SHA256 del cuerpo EXACTO que se manda, con el secreto del webhook. */
export function firmar(cuerpo, secreto) {
  return `sha256=${crypto.createHmac('sha256', secreto).update(cuerpo, 'utf8').digest('hex')}`;
}

/** Un secreto nuevo. Se enseña una vez; en la base, cifrado. */
export function generarSecreto() {
  return `whsec_${crypto.randomBytes(32).toString('base64url')}`;
}

/** Cifra el secreto y se queda con la cola para reconocerlo en la lista. */
export function cifrarSecreto(secreto) {
  return { ...encrypt(secreto), cola: secreto.slice(-4) };
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dos = (v) => Math.round(Number(v) * 100) / 100;

/**
 * El payload de un cobro. `enviado_at` se pone en cada intento, al enviar: el
 * resto no cambia entre intentos, y la `idempotency_key` tampoco.
 */
export function construirPayload(d, { evento, idempotencyKey, prueba = false }) {
  const total = num(d.importe_total) ?? 0;
  const pagado = num(d.importe_pagado) ?? 0;
  const divisa = d.divisa_moneda && String(d.divisa_moneda).toUpperCase() !== 'EUR' && d.importe_divisa != null
    ? { moneda: String(d.divisa_moneda).toUpperCase(), importe: num(d.importe_divisa) }
    : null;
  return {
    evento,
    prueba: Boolean(prueba),
    idempotency_key: idempotencyKey,
    // El importe de ESTE cobro: la transferencia que se acaba de registrar, no el total
    // de la venta (ese va en venta.importe_total). Diego, 21/10/2026.
    importe: num(d.importe),
    // Lo mismo, plano y con nombres en español, para los escenarios de Make montados así
    // (Diego, 21/10/2026: el de Psiko espera «Nombre completo», «Email», «Formación», «Importe»…;
    // «deben estar acomodados en todos»). «Importe» es el de ESTE cobro, no el total.
    'Nombre completo': d.cliente_nombre || null,
    Email: d.cliente_email || null,
    'Teléfono': d.cliente_telefono || null,
    'Formación': d.producto_catalogo || d.producto_contratado || null,
    Importe: num(d.importe),
    Moneda: 'EUR',
    'Fecha de pago': d.fecha ? String(d.fecha).slice(0, 10) : null,
    Referencia: d.referencia || null,
    Comercial: d.gestora_nombre || null,
    cobro: {
      id: d.id,
      importe: num(d.importe),
      // El importe del cobro en el CRM es siempre en euros (`divisa` es lo que
      // vio el cliente cuando pagó en otra moneda, migración 112).
      moneda: 'EUR',
      fecha: d.fecha ? String(d.fecha).slice(0, 10) : null,
      metodo: d.metodo,
      referencia: d.referencia || null,
      notas: d.notas || null,
      divisa,
    },
    venta: {
      id: d.venta_id,
      producto: d.producto_catalogo || d.producto_contratado || null,
      producto_id: d.producto_contratado_id ?? null,
      importe_total: total,
      pagado,
      pendiente: Math.max(0, dos(total - pagado)),
    },
    cliente: {
      id: d.cliente_id ?? null,
      nombre: d.cliente_nombre || null,
      email: d.cliente_email || null,
      telefono: d.cliente_telefono || null,
      dni_nif: d.cliente_dni || null,
    },
    campus: { id: d.campus_id, nombre: d.campus_nombre || null },
    empresa: d.empresa_id
      ? { id: d.empresa_id, razon_social: d.empresa_razon_social || null, nif: d.empresa_nif || null }
      : null,
    cuenta_destino: d.iban || d.bic
      ? { iban: d.iban || null, bic: d.bic || null }
      : null,
    gestora: d.gestora_id
      ? { id: d.gestora_id, nombre: d.gestora_nombre || null, email: d.gestora_email || null }
      : null,
    registrado_por: d.registrado_id
      ? { id: d.registrado_id, nombre: d.registrado_nombre || null, email: d.registrado_email || null }
      : null,
  };
}

/** Un ejemplo inventado, con la misma forma. Para «Enviar prueba» y para la pantalla. */
export function payloadDeEjemplo({ metodo = 'transferencia', prueba = true, idempotencyKey = 'prueba-ejemplo', real = {} } = {}) {
  // Lo que se sabe del webhook de verdad (campus, empresa, cuenta, quien lo lanza) manda
  // sobre lo inventado; lo que no se sabe, se queda de ejemplo.
  const deVerdad = Object.fromEntries(Object.entries(real || {}).filter(([, v]) => v != null && v !== ''));
  return construirPayload({
    // Una transferencia de 250 € de una venta de 1.000 €: el importe que viaja es el de la
    // transferencia registrada, no el total (Diego, 21/10/2026).
    id: 12345, importe: '250.00', fecha: new Date().toISOString().slice(0, 10), metodo,
    referencia: 'TRF-PRUEBA-0001', notas: 'Transferencia de prueba', divisa_moneda: null, importe_divisa: null,
    venta_id: 678, producto_contratado: 'Producto de prueba', producto_contratado_id: null,
    producto_catalogo: 'Producto de prueba', importe_total: '1000.00', importe_pagado: '250.00',
    cliente_id: null, cliente_nombre: 'Cliente de prueba', cliente_email: 'prueba@example.com',
    cliente_telefono: '+34600000000', cliente_dni: 'PRUEBA',
    campus_id: 1, campus_nombre: 'Campus de ejemplo',
    empresa_id: 2, empresa_razon_social: 'Empresa de ejemplo S.L.', empresa_nif: 'B00000000',
    iban: 'ES00 0000 0000 0000 0000 0000', bic: 'XXXXESMMXXX',
    gestora_id: 7, gestora_nombre: 'Gestora de ejemplo', gestora_email: 'gestora@example.com',
    registrado_id: 7, registrado_nombre: 'Gestora de ejemplo', registrado_email: 'gestora@example.com',
    ...deVerdad,
  }, { evento: EVENTO_DE[metodo] || EVENTO_DE.transferencia, idempotencyKey, prueba });
}

/** Las cabeceras que lleva cada envío, para documentarlas en la pantalla. */
export const CABECERAS = [
  { nombre: 'Content-Type', valor: 'application/json' },
  { nombre: 'X-CRM-Evento', valor: 'cobro.transferencia | cobro.deposito' },
  { nombre: 'X-CRM-Entrega', valor: 'id del envío en el registro (el mismo en sus reintentos)' },
  { nombre: 'X-CRM-Firma', valor: 'sha256=<HMAC-SHA256 en hexadecimal del cuerpo, con el secreto del webhook>' },
  { nombre: 'X-CRM-Idempotencia', valor: 'la idempotency_key: cobro-<id>-webhook-<id>' },
];

/** ¿Merece la pena volver a probar? */
const reintentable = (status) => status === 408 || status === 429 || status >= 500;

/**
 * Manda un envío (un intento). Lo reclama primero: si otro proceso ya lo tiene o
 * aún no le toca, no hace nada y devuelve null. Nunca lanza.
 */
export async function procesarEnvio(envioId) {
  let envio;
  try {
    envio = await model.reclamarEnvio(envioId);
  } catch (err) {
    logger.warn({ err: err.message, envioId }, 'webhook de transferencias: no se pudo reclamar el envío');
    return null;
  }
  if (!envio) return null;

  const fallo = async ({ error, httpStatus = null, respuesta = null, permanente = false }) => {
    // Una prueba es un solo intento: quien la lanza está mirando la pantalla.
    const quedan = !envio.prueba && !permanente && envio.intentos < MAX_INTENTOS;
    const espera = quedan ? ESPERAS_MS[Math.min(envio.intentos - 1, ESPERAS_MS.length - 1)] : null;
    logger.warn({ envioId, webhookId: envio.webhook_id, intento: envio.intentos, httpStatus, error, reintentoEnMs: espera },
      'webhook de transferencias: envío fallido');
    try {
      return await model.marcarFallo(envio.id, {
        httpStatus, respuesta, error: String(error).slice(0, 500), reintentarEnMs: espera,
      });
    } catch (err) {
      // Si ni siquiera se puede apuntar, se queda «enviando» y el rescate de
      // atascados lo devuelve a la cola a los cinco minutos.
      logger.warn({ err: err.message, envioId }, 'webhook de transferencias: no se pudo apuntar el fallo');
      return null;
    }
  };

  try {
    const w = await model.conSecreto(envio.webhook_id);
    if (!w) return fallo({ error: 'El webhook ya no existe', permanente: true });
    if (!w.activo && !envio.prueba) return fallo({ error: 'El webhook está apagado', permanente: true });

    await comprobarDestino(w.url);
    const secreto = decrypt(w.secreto_cifrado, w.secreto_iv, w.secreto_tag);
    const cuerpo = JSON.stringify({ ...envio.payload, enviado_at: new Date().toISOString() });

    const res = await fetch(w.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CRM-Webhook-Transferencias/1.0',
        'X-CRM-Evento': envio.evento,
        'X-CRM-Entrega': String(envio.id),
        'X-CRM-Firma': firmar(cuerpo, secreto),
        'X-CRM-Idempotencia': envio.idempotency_key,
      },
      body: cuerpo,
      // Una redirección podría llevar los datos a otro sitio: no se sigue.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let respuesta = null;
    try { respuesta = (await res.text()).slice(0, RESPUESTA_MAX) || null; } catch { /* sin cuerpo */ }

    if (res.status >= 200 && res.status < 300) {
      return model.marcarEnviado(envio.id, { httpStatus: res.status, respuesta });
    }
    return fallo({
      httpStatus: res.status,
      respuesta,
      error: res.status >= 300 && res.status < 400
        ? `El destino contestó ${res.status} (redirección): pon la URL final`
        : `El destino contestó ${res.status}`,
      permanente: !reintentable(res.status),
    });
  } catch (err) {
    const tiempo = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return fallo({
      error: tiempo ? `El destino no contestó en ${Math.round(TIMEOUT_MS / 1000)} s` : (err?.message || String(err)),
      permanente: Boolean(err?.permanente),
    });
  }
}

/**
 * EL PUNTO COMÚN. Se ha apuntado (o cambiado) un cobro: si es por transferencia
 * o depósito, se apunta un envío para cada webhook que le toque y se manda.
 *
 * Devuelve los ids de los envíos nuevos. Nunca lanza: un webhook que falla no
 * puede deshacer un cobro.
 *
 * `metodo` es una pista para no ir a la base con cada cobro con tarjeta; la
 * decisión se toma con el que está guardado.
 */
export async function avisarCobro(paymentId, { userId = null, metodo } = {}) {
  if (!paymentId) return [];
  if (metodo !== undefined && !METODOS_QUE_DISPARAN.includes(metodo)) return [];
  try {
    const d = await model.datosDelCobro(paymentId, userId);
    if (!d || !METODOS_QUE_DISPARAN.includes(d.metodo)) return [];
    const ids = await model.webhooksParaCobro({ metodo: d.metodo, projectId: d.campus_id, issuerId: d.empresa_id });
    const nuevos = [];
    for (const webhookId of ids) {
      const idempotencyKey = claveDeIdempotencia(paymentId, webhookId);
      const payload = construirPayload(d, { evento: EVENTO_DE[d.metodo], idempotencyKey });
      const envioId = await model.crearEnvio({
        webhookId, paymentId, evento: EVENTO_DE[d.metodo], idempotencyKey, payload,
      });
      if (envioId) nuevos.push(envioId);
    }
    for (const id of nuevos) await procesarEnvio(id);
    if (nuevos.length) logger.info({ paymentId, metodo: d.metodo, envios: nuevos }, 'webhook de transferencias: cobro avisado');
    return nuevos;
  } catch (err) {
    // Sin la migración 206, o con la base caída: se dice y se sigue.
    logger.warn({ err: err.message, paymentId }, 'webhook de transferencias: no se pudo avisar del cobro');
    return [];
  }
}

/** Lo mismo, sin esperar: para llamarlo justo después del COMMIT. */
export function dispararCobro(paymentId, opciones = {}) {
  if (!paymentId) return;
  if (opciones.metodo !== undefined && !METODOS_QUE_DISPARAN.includes(opciones.metodo)) return;
  setImmediate(() => {
    avisarCobro(paymentId, opciones).catch((err) =>
      logger.warn({ err: err.message, paymentId }, 'webhook de transferencias: fallo al disparar'));
  });
}

/**
 * «Enviar prueba»: con `"prueba": true` y un solo intento. Lleva la misma forma que un aviso
 * de verdad y lo que se sabe de verdad del webhook —su campus, su empresa, la cuenta de
 * destino y quien la lanza—; el cliente y el producto son de prueba, y el importe es el de una
 * transferencia, no el total de la venta (Diego, 21/10/2026: «para saber qué va a mandar»).
 */
export async function enviarPrueba(webhook, userId = null) {
  const metodo = (webhook.metodos || [])[0] || 'transferencia';
  const idempotencyKey = `prueba-${webhook.id}-${crypto.randomUUID()}`;
  let real = {};
  try {
    real = await model.datosParaPrueba({ projectId: webhook.project_id ?? null, issuerId: webhook.issuer_id ?? null, userId });
  } catch (err) {
    logger.warn({ err: err.message, webhookId: webhook.id }, 'webhook de transferencias: la prueba sale con datos de ejemplo');
  }
  // Los correos de una prueba van a quien la lanza: el escenario de Make manda correos al
  // cliente y a la gestora, y a un @example.com no puede escribir (Diego, 21/10/2026: «554
  // Recipient domain is reserved»). Así le llegan a él y ve lo que va a recibir cada uno.
  if (real?.registrado_email) {
    real = { ...real, cliente_email: real.registrado_email, gestora_email: real.registrado_email };
  }
  const payload = payloadDeEjemplo({ metodo, prueba: true, idempotencyKey, real });
  const envioId = await model.crearEnvio({
    webhookId: webhook.id, evento: payload.evento, idempotencyKey, prueba: true, payload,
  });
  return (await procesarEnvio(envioId)) || model.envioPorId(envioId);
}

/** Reenviar uno fallido, con su misma clave. Vuelve a tener sus reintentos. */
export async function reenviar(envioId, userId) {
  const listo = await model.prepararReenvio(envioId, userId);
  if (!listo) return null;
  return (await procesarEnvio(envioId)) || model.envioPorId(envioId);
}

/** La vuelta del reintento (jobs/webhooksSalientesScheduler.js). */
export async function procesarPendientes({ limite = 20 } = {}) {
  const rescatados = await model.rescatarAtascados(MAX_INTENTOS);
  const ids = await model.pendientesQueTocan(limite);
  let enviados = 0;
  let fallidos = 0;
  let aReintentar = 0;
  for (const id of ids) {
    const r = await procesarEnvio(id);
    if (!r) continue;
    if (r.estado === 'enviado') enviados += 1;
    else if (r.estado === 'fallido') fallidos += 1;
    else aReintentar += 1;
  }
  return { rescatados, intentados: ids.length, enviados, fallidos, aReintentar };
}
