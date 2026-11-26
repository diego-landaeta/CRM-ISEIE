import * as stripe from './links-pago.stripe.js';
import { claveObligatoria } from './links-pago.service.js';
import { duenoDeLaCuenta, quienesLaUsan } from '../stripe-payments/stripe-prestado.js';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';

/*
  «LINK DE PAGO USADO» EN LA VENTA (CRM-ISEIE#762, gemela de CRM#1107; Diego, 24/11/2026).

  La inicial ya se pagó con otro link (o con Stripe) y la gestora registra la
  venta. Hasta ahora lo que pegaba se guardaba como texto
  (`referencia_pago_inicial` → `conversion_payments.referencia`) y el cargo de
  Stripe se quedaba suelto: si el alumno pagó con otro correo, nadie lo unía.

  Ahora se busca en Stripe con la clave de los links del campus (la de su cuenta
  si usa la de otro, «Stripe prestado») y, si no deja, con la de lectura:
    · https://buy.stripe.com/… o plink_… → las sesiones pagadas de ese link;
    · cs_… → esa sesión; pi_… → ese pago; ch_…/py_… → ese cargo.
  El cargo se UNE al pago inicial que acaba de crear la venta, como «Asociar con
  un cobro» (`enlazarConCobro`): sin crear otro cobro, aunque el correo sea otro.

  CONTRA EL DINERO CONTADO DOS VECES (feedback de julio): el pago inicial ya
  cuenta ese dinero, así que el cargo va a ESE cobro y no se suma nada. Y no se
  une:
    · si el cargo ya está en otra venta: se dice y no se mueve (esa venta y esta
      contarían lo mismo, hay que mirarlo);
    · si su importe no es el de la inicial (más de 1 € de diferencia);
    · si el link tiene varios cobros posibles: se pide el id del cobro.
  En todos esos casos, y si no se encuentra, la referencia queda guardada como
  hasta ahora y se dice por qué.
*/

const ID = /(?<![A-Za-z0-9])(plink|cs_(?:live|test)|pi|ch|py)_[A-Za-z0-9]{4,}/;

/** Lo que pegó la gestora, entendido: `{ tipo, valor }` o null si no es de Stripe. */
export function leerReferencia(texto) {
  const t = String(texto || '').trim();
  if (!t || t.length > 500) return null;
  const id = t.match(ID);
  if (id) {
    const tipo = id[1].startsWith('cs_') ? 'cs' : id[1];
    return { tipo, valor: id[0] };
  }
  if (/^https?:\/\/\S+$/i.test(t)) {
    const url = t.replace(/[?#].*$/, '').replace(/\/+$/, '');
    return { tipo: 'url', valor: url, deStripe: /^https?:\/\/([a-z0-9-]+\.)*stripe\.com\//i.test(`${url}/`) };
  }
  return null;
}

/** Las claves con las que se puede leer, por orden: la de los links y la de lectura. */
async function clavesDe(projectId) {
  const claves = [];
  try { claves.push(await claveObligatoria(projectId)); } catch { /* sin clave de links: la de lectura */ }
  try {
    const { getStripeKey } = await import('../stripe-payments/stripe-payments.service.js');
    const lectura = await getStripeKey(projectId);
    if (lectura && !claves.includes(lectura)) claves.push(lectura);
  } catch { /* sin clave de lectura */ }
  return claves;
}

/** Pide algo a Stripe con la primera clave que deje. null si no existe (404). */
async function pedir(claves, fn) {
  let ultimo = null;
  for (const k of claves) {
    try { return await fn(k); } catch (err) {
      if (err instanceof stripe.ErrorDeStripe && err.status === 404) return null;
      if (err instanceof stripe.ErrorDeStripe && (err.status === 401 || err.status === 403)) { ultimo = err; continue; }
      throw err;
    }
  }
  if (ultimo) throw ultimo;
  return null;
}

/** El plink_ de una dirección de pago: de los links del CRM, de los creados en Stripe o de la cuenta. */
async function plinkDeLaUrl(familia, url, claves, deStripe) {
  const { rows } = await query(
    `SELECT stripe_payment_link_id AS id FROM payment_links
      WHERE project_id = ANY($1::int[]) AND rtrim(url, '/') = $2 AND stripe_payment_link_id IS NOT NULL
     UNION ALL
     SELECT stripe_payment_link_id FROM stripe_links_externos
      WHERE project_id = ANY($1::int[]) AND rtrim(url, '/') = $2
     LIMIT 1`,
    [familia, url]);
  if (rows[0]?.id) return rows[0].id;
  if (!deStripe) return null;
  const links = await pedir(claves, (k) => stripe.listarLinks(k, { maxPaginas: 3 }));
  return (links || []).find((l) => String(l.url || '').replace(/\/+$/, '') === url)?.id || null;
}

/** Los cargos de Stripe (objetos) a los que apunta la referencia, o `{ motivo }`. */
async function cargosDeStripe(ref, claves, familia) {
  const delPago = async (pi) => {
    const r = await pedir(claves, (k) => stripe.cargosDelPago(k, pi));
    return Array.isArray(r?.data) ? r.data : [];
  };
  const deSesiones = async (sesiones) => {
    const pagadas = sesiones.filter((s) => s.payment_status === 'paid' && s.payment_intent);
    const cargos = [];
    for (const s of pagadas.slice(0, 20)) {
      cargos.push(...await delPago(typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent.id));
    }
    return cargos;
  };
  switch (ref.tipo) {
    case 'ch':
    case 'py': {
      const ch = await pedir(claves, (k) => stripe.verCargo(k, ref.valor));
      return ch ? [ch] : [];
    }
    case 'pi': return delPago(ref.valor);
    case 'cs': {
      const s = await pedir(claves, (k) => stripe.verSesion(k, ref.valor));
      if (!s) return [];
      if (s.payment_status !== 'paid') return { motivo: 'sin_pagar' };
      return deSesiones([s]);
    }
    case 'plink':
    case 'url': {
      const plink = ref.tipo === 'plink' ? ref.valor : await plinkDeLaUrl(familia, ref.valor, claves, ref.deStripe);
      if (!plink) return [];
      const r = await pedir(claves, (k) => stripe.sesionesPagadasDelLink(k, plink));
      return deSesiones(Array.isArray(r?.data) ? r.data : []);
    }
    default: return [];
  }
}

const FILA = `SELECT sp.id, sp.project_id, sp.stripe_id, sp.status, sp.amount::float8 AS amount, sp.customer_email,
                     sp.conversion_id, sp.conversion_payment_id, sp.stripe_created_at, l.nombre AS venta_cliente
                FROM stripe_payments sp
                LEFT JOIN conversions c ON c.id = sp.conversion_id
                LEFT JOIN leads l ON l.id = c.lead_id`;

/**
 * Las filas de `stripe_payments` de esos cargos. Un cargo que el sondeo aún no ha
 * traído se trae ahora, como lo haría él, solo si el campus tiene su cuenta para
 * él solo (sin préstamo): así no puede acabar en dos campus.
 */
async function filasDe(projectId, familia, cargos) {
  const ids = [...new Set(cargos.map((c) => c.id).filter(Boolean))];
  if (!ids.length) return [];
  const { rows } = await query(`${FILA} WHERE sp.stripe_id = ANY($1::text[]) AND sp.project_id = ANY($2::int[])`, [ids, familia]);
  const faltan = ids.filter((id) => !rows.some((r) => r.stripe_id === id));
  if (!faltan.length || familia.length > 1) return rows;
  const { chargeToPayment } = await import('../stripe-payments/stripe-payments.service.js');
  const sm = await import('../stripe-payments/stripe-payments.model.js');
  for (const ch of cargos.filter((c) => faltan.includes(c.id))) {
    const fila = await sm.upsertPayment(chargeToPayment(ch, projectId));
    logger.info({ projectId, stripeId: ch.id, id: fila?.id }, 'link de pago usado: cargo traído de Stripe para unirlo a su venta');
  }
  const { rows: ahora } = await query(`${FILA} WHERE sp.stripe_id = ANY($1::text[]) AND sp.project_id = ANY($2::int[])`, [ids, familia]);
  return ahora;
}

const euros = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fechaDe = (f) => (f ? new Date(f).toISOString().slice(0, 10).split('-').reverse().join('/') : '');
const GUARDADA = 'Se guarda como referencia del pago inicial, como hasta ahora.';

function resumenDelCargo(c) {
  return {
    id: Number(c.id), stripe_id: c.stripe_id, importe: Number(c.amount), fecha: c.stripe_created_at,
    email: c.customer_email || null, conversion_id: c.conversion_id ? Number(c.conversion_id) : null,
    venta_cliente: c.venta_cliente || null,
  };
}

/**
 * Busca el cobro de una referencia y, si se puede, lo une al pago inicial de la
 * venta. Con `soloMirar` (el botón «Buscar en Stripe» del formulario) no une
 * nada: dice lo que pasaría. Devuelve `{ estado, mensaje, cargo? }`; nunca lanza.
 *
 * estado: unido · encontrado (soloMirar) · ya_unido · en_otra_venta ·
 * importe_distinto · varios · sin_pagar · no_encontrado · no_es_de_stripe · error.
 */
export async function unirCargoDeLaReferencia({
  projectId, referencia, importe = null, conversionId = null, conversionPaymentId = null, userId = null, soloMirar = false,
}) {
  const ref = leerReferencia(referencia);
  if (!ref) return { estado: 'no_es_de_stripe', mensaje: `No parece un link ni un id de Stripe. ${GUARDADA}` };
  try {
    const dueno = await duenoDeLaCuenta(projectId);
    const familia = [...new Set([Number(projectId), Number(dueno), ...(await quienesLaUsan(dueno))])];
    const claves = await clavesDe(projectId);
    if (!claves.length) return { estado: 'no_encontrado', mensaje: `Este campus no tiene clave de Stripe para buscarlo. ${GUARDADA}` };
    const cargos = await cargosDeStripe(ref, claves, familia);
    if (cargos?.motivo === 'sin_pagar') {
      return { estado: 'sin_pagar', mensaje: `Esa sesión de pago de Stripe no se llegó a pagar. ${GUARDADA}` };
    }
    const filas = (await filasDe(projectId, familia, cargos)).filter((f) => f.status === 'succeeded');
    if (!filas.length) {
      return { estado: 'no_encontrado', mensaje: `No se ha encontrado ningún cobro pagado de esa referencia en Stripe. ${GUARDADA}` };
    }
    if (conversionId) {
      const yaAqui = filas.find((f) => Number(f.conversion_id) === Number(conversionId));
      if (yaAqui) return { estado: 'ya_unido', mensaje: 'Ese cobro de Stripe ya estaba unido a esta venta.', cargo: resumenDelCargo(yaAqui) };
    }
    const delImporte = importe == null ? filas : filas.filter((f) => Math.abs(Number(f.amount) - Number(importe)) <= 1);
    if (!delImporte.length) {
      const f = filas[0];
      return {
        estado: 'importe_distinto', cargo: resumenDelCargo(f),
        mensaje: `El cobro de Stripe es de ${euros(f.amount)} y la inicial de ${euros(importe)}: no se ha unido. ${GUARDADA}`,
      };
    }
    const libres = delImporte.filter((f) => !f.conversion_id);
    if (!libres.length) {
      const f = delImporte[0];
      return {
        estado: 'en_otra_venta', cargo: resumenDelCargo(f),
        mensaje: `Ese cobro de Stripe (${euros(f.amount)} del ${fechaDe(f.stripe_created_at)}) ya está unido a la venta n.º ${f.conversion_id}`
          + `${f.venta_cliente ? ` de ${f.venta_cliente}` : ''}: no se ha movido. Si es el mismo dinero, esta venta y aquella lo cuentan dos veces: revisa cuál es la buena.`,
      };
    }
    if (libres.length > 1) {
      return {
        estado: 'varios',
        mensaje: `Ese link tiene ${libres.length} cobros de ese importe sin unir: pega el id del cobro (pi_… o ch_…) para elegir. ${GUARDADA}`,
      };
    }
    const cargo = libres[0];
    if (Number(cargo.project_id) !== Number(projectId)) {
      return {
        estado: 'no_encontrado', cargo: resumenDelCargo(cargo),
        mensaje: `Ese cobro está en otro campus de la misma cuenta de Stripe: únelo desde allí. ${GUARDADA}`,
      };
    }
    const quien = cargo.customer_email ? ` (pagó con ${cargo.customer_email})` : '';
    if (soloMirar || !conversionPaymentId) {
      return {
        estado: 'encontrado', cargo: resumenDelCargo(cargo),
        mensaje: `Encontrado: ${euros(cargo.amount)} del ${fechaDe(cargo.stripe_created_at)}${quien}. Al registrar la venta se une a su pago inicial.`,
      };
    }
    const { enlazarConCobro } = await import('../stripe-payments/stripe-payments.service.js');
    await enlazarConCobro(cargo.id, { conversionPaymentId, userId });
    logger.info({ projectId, conversionId, conversionPaymentId, stripeId: cargo.stripe_id, tipo: ref.tipo },
      'link de pago usado: cargo de Stripe unido al pago inicial de la venta');
    return {
      estado: 'unido', cargo: { ...resumenDelCargo(cargo), conversion_id: Number(conversionId) },
      mensaje: `Cobro de Stripe unido a la venta: ${euros(cargo.amount)} del ${fechaDe(cargo.stripe_created_at)}${quien}.`,
    };
  } catch (err) {
    logger.warn({ err: err.message, code: err.code, projectId, conversionId }, 'link de pago usado: no se pudo buscar o unir el cobro');
    const motivo = err.code === 'CARGO_YA_ENLAZADO' || err.code === 'COBRO_YA_TIENE_CARGO' ? err.message : 'Stripe no ha contestado.';
    return { estado: 'error', mensaje: `No se ha podido unir el cobro: ${motivo} ${GUARDADA}` };
  }
}
