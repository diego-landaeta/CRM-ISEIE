import * as model from './links-pago.model.js';
import * as stripe from './links-pago.stripe.js';
import * as integrationsModel from '../integrations/integrations.model.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  LINKS DE PAGO, FASE 2 (CRM#680): crear, anular y caducar un link de pago único, y
  el webhook de la cuenta desde la tarjeta.

  Decisión de Diego (17/11): todo lo de Stripe se configura desde la web. La
  clave es la de ESCRITURA del campus (`stripe_links`), nunca la de lectura ni
  una del `.env`: si el campus no la tiene, no se crea nada.

  Atar el cobro a la venta por la marca (`crm_link_id`) es la fase 3, en
  `links-pago.cobro.js`; las cuotas, la 4.
*/

/**
 * Dónde corre el CRM, para la marca del link: produccion, staging o local.
 *
 * En ISEIE las pruebas viven en /staging (en MultiCRM, /staging): se miran las
 * dos, como `enPruebasOAprobado`. Si no, el servidor de pruebas diría
 * «produccion» y dejaría crear links con una clave live.
 */
export function entorno(env = process.env) {
  if (/\/(staging|testeo)(\/|$)/.test(env.CRM_BASE_URL || '')) return 'staging';
  return env.NODE_ENV === 'production' ? 'produccion' : 'local';
}

/** La clave de escritura del campus, o null. Solo `stripe_links`. */
export async function claveDeEscritura(projectId) {
  const row = await integrationsModel.get(projectId, 'stripe_links');
  if (!row?.encrypted_value) return null;
  try {
    return decrypt(row.encrypted_value, row.iv, row.auth_tag);
  } catch (err) {
    logger.error({ err: err.message, projectId }, 'Links de pago: la clave de escritura no se puede descifrar');
    return null;
  }
}

export async function claveObligatoria(projectId) {
  const clave = await claveDeEscritura(projectId);
  if (!clave) {
    throw new AppError('Este campus no tiene la clave de links de pago. La pone un admin en Integraciones › Links de pago.',
      409, 'SIN_CLAVE_DE_LINKS');
  }
  // Fuera de producción, solo claves de test: en /staging o en local nadie debe
  // poder generar un cobro de verdad por error.
  if (entorno() !== 'produccion' && /^(sk|rk)_live_/.test(clave)) {
    throw new AppError('En pruebas solo se crean links con una clave de test (rk_test_…).', 409, 'CLAVE_LIVE_EN_PRUEBAS');
  }
  return clave;
}

/**
 * Lo que diría «Crear link» por la clave, dicho ANTES (QA de /testeo del
 * 18/11): sin clave, el diálogo dejaba rellenarlo todo y avisaba al final.
 * `null` si con la clave del campus se pueden crear links aquí; si no, el mismo
 * mensaje y código que daría el POST. La clave no sale de aquí.
 */
export async function avisoDeClave(projectId) {
  try {
    await claveObligatoria(projectId);
    return null;
  } catch (err) {
    if (err instanceof AppError) return { code: err.code, error: err.message };
    throw err;
  }
}

export function errorDeStripe(err, que) {
  if (err instanceof stripe.ErrorDeStripe) {
    const sinPermiso = err.status === 401 || err.status === 403;
    return new AppError(
      sinPermiso
        ? `Stripe no deja ${que} con la clave de este campus (${err.status}). Revisa sus permisos en Integraciones › Links de pago.`
        : `Stripe no ha podido ${que}: ${err.message}`,
      // 424 y no 502: un 5xx se le esconde a la gestora tras «Error del sistema», y
      // esto le dice qué hacer (o a quién avisar).
      424, 'STRIPE_ERROR');
  }
  return err;
}

const redondear2 = (n) => Math.round(n * 100) / 100;

/**
 * El descuento sobre el precio del catálogo, en %. Cobrar más que el catálogo
 * no es un descuento (0). Sin precio de catálogo, null: no se puede medir.
 */
export function descuentoSobre(precioCatalogo, importe) {
  const precio = Number(precioCatalogo);
  if (!(precio > 0)) return null;
  return Math.max(0, redondear2(((precio - Number(importe)) / precio) * 100));
}

/** El importe más bajo que admite el tope de descuento, redondeado hacia arriba al céntimo. */
export function importeMinimo(precioCatalogo, maxPct) {
  const precioC = Math.round(Number(precioCatalogo) * 100);
  const maxB = Math.round(Number(maxPct) * 100); // centésimas de punto
  // Techo de una división entera, sin coma flotante en medio.
  return Math.floor((precioC * (10000 - maxB) + 9999) / 10000) / 100;
}

/**
 * Lo que se va a cobrar, comprobado contra las reglas del campus. No llama a
 * Stripe ni escribe nada: devuelve lo que hay que guardar o lanza un 400/403.
 *
 *   · moneda: una de las admitidas (por defecto, la del campus);
 *   · caducidad: de 1 al máximo del campus (por defecto, la del campus);
 *   · descuento: hasta el tope del campus, salvo quien configura (el admin);
 *   · sin precio comparable (curso sin precio, o en otra moneda): solo el admin.
 */
/*
 * DESDE UNA VENTA, EL TOPE SE MIDE CONTRA LO PENDIENTE (CRM#680, fase 3).
 *
 * En una venta ya hay un precio pactado y quizá pagos hechos: lo que se le puede
 * pedir al cliente es lo que falta. Si se midiera contra el catálogo, un link por
 * lo pendiente de una venta a medio pagar saldría como un «descuento» enorme, y
 * uno de una venta pactada por encima del catálogo dejaría rebajar más de la
 * cuenta. `pendiente` (en euros, como guarda el CRM) solo llega desde una venta;
 * sin nada pendiente, o en otra moneda, no hay con qué comparar: solo el admin.
 */
/*
 * EN CUOTAS (Carlos y Diego, 20/11): el importe es el TOTAL del curso y se mide
 * contra el catálogo igual que un pago único. Las cuotas van en euros (es como
 * guarda el CRM el plan de la venta), y no hay cuotas desde una venta: la venta
 * ya tiene su plan («Generar plan de pago»).
 */
/*
 * INICIAL MÁS CUOTAS (CRM#982, Diego 21/11): «un enlace de pago es la inicial y
 * lo otro son las cuotas». Con `inicial`, el link cobra la inicial y `numCuotas`
 * son las cuotas de DESPUÉS (de 1 al máximo del campus), iguales, sobre lo que
 * queda. La inicial, como cualquier cobro de Stripe, de al menos 0,50 €, y menor
 * que el total. Sin `inicial`, como antes: el total entre `numCuotas` (de 2).
 */
/*
 * LA MONEDA DEL CAMPUS (CRM#986, Diego 21/11): «el link sale en la moneda del
 * campus (MXN, COP, CLP…), con el precio del curso en esa moneda cuando lo haya».
 * Sin moneda pedida, la que se propone (`monedaPropuesta`). En una moneda sin
 * decimales en Stripe (CLP…), el importe va en unidades enteras: 1.500,50 CLP se
 * cobraría como 1.501 sin decirlo.
 */
export function comprobarReglas({ cfg, prod, importe, moneda, caducidadDias, modalidad, numCuotas, inicial, plan, hoy, esAdmin, pendiente }) {
  if (modalidad === 'cuotas') {
    if (pendiente !== undefined && pendiente !== null) {
      throw new AppError('Una venta ya tiene su plan: para cobrarla a plazos, usa «Generar plan de pago» en la venta.', 400, 'CUOTAS_DESDE_VENTA');
    }
    if ((moneda || 'EUR') !== 'EUR') {
      throw new AppError('Los links en cuotas van en euros.', 400, 'MONEDA_NO_ADMITIDA');
    }
    if (!cfg.cuotas_admitidas) {
      throw new AppError('Este campus no admite pagos en cuotas (Integraciones › Links de pago).', 400, 'CUOTAS_NO_ADMITIDAS');
    }
    const conInicial = inicial !== undefined && inicial !== null;
    if (!(numCuotas >= (conInicial ? 1 : 2)) || numCuotas > cfg.cuotas_max) {
      throw new AppError(conInicial
        ? `En este campus, de 1 a ${cfg.cuotas_max} cuotas después de la inicial.`
        : `En este campus, de 2 a ${cfg.cuotas_max} cuotas.`, 400, 'CUOTAS_MAXIMAS');
    }
    if (conInicial) {
      if (!(Math.round(Number(inicial) * 100) < Math.round(Number(importe) * 100))) {
        throw new AppError('La inicial tiene que ser menor que el total.', 400, 'INICIAL_NO_VALIDA');
      }
      if (!(Number(inicial) >= 0.5)) {
        throw new AppError('La inicial tiene que ser de al menos 0,50 €: Stripe no cobra menos.', 400, 'CUOTA_MINIMA');
      }
    }
    const importes = plan?.length
      ? plan.map((c) => Number(c.importe))
      : (conInicial ? repartirEnCuotas(restaCentimos(importe, inicial), numCuotas) : repartirEnCuotas(importe, numCuotas));
    if (!importes.every((i) => i >= 0.5)) {
      throw new AppError('Cada cuota tiene que ser de al menos 0,50 €: Stripe no cobra menos.', 400, 'CUOTA_MINIMA');
    }
    if (plan?.length) comprobarFechasDelPlan(plan, hoy);
  }
  const mon = modalidad === 'cuotas'
    ? 'EUR'
    : (moneda || monedaPropuesta({ cfg, prod, desdeVenta: pendiente !== undefined && pendiente !== null }));
  if (!cfg.monedas.includes(mon)) {
    throw new AppError(`Este campus no cobra en ${mon}. Monedas admitidas: ${cfg.monedas.join(', ')}.`, 400, 'MONEDA_NO_ADMITIDA');
  }
  if (stripe.esSinDecimales(mon) && !Number.isInteger(Math.round(Number(importe) * 100) / 100)) {
    throw new AppError(`En ${mon} el importe va sin decimales.`, 400, 'IMPORTE_SIN_DECIMALES');
  }
  const dias = caducidadDias ?? cfg.caducidad_dias;
  if (dias > cfg.caducidad_max_dias) {
    throw new AppError(`La caducidad no puede pasar de ${cfg.caducidad_max_dias} días en este campus.`, 400, 'CADUCIDAD_MAXIMA');
  }

  const mismaMoneda = !prod.moneda || String(prod.moneda).toUpperCase() === mon;
  const precio = prod.precio != null && Number(prod.precio) > 0 && mismaMoneda ? Number(prod.precio) : null;
  const desdeVenta = pendiente !== undefined && pendiente !== null;
  // Contra qué se mide el descuento: lo pendiente de la venta, o el catálogo.
  const referencia = desdeVenta
    ? (mon === 'EUR' && Number(pendiente) > 0 ? Number(pendiente) : null)
    : precio;
  const descuento = referencia == null ? null : descuentoSobre(referencia, importe);
  if (referencia == null && !esAdmin) {
    let motivo;
    if (desdeVenta) {
      motivo = mon !== 'EUR'
        ? `Lo pendiente de la venta está en EUR: un link en ${mon} lo tiene que crear un admin.`
        : 'Esta venta no tiene nada pendiente de cobro: el link lo tiene que crear un admin.';
    } else {
      motivo = mismaMoneda
        ? 'Este curso no tiene precio en el catálogo: el link lo tiene que crear un admin.'
        : `El precio del catálogo está en ${String(prod.moneda).toUpperCase()}: un link en ${mon} lo tiene que crear un admin.`;
    }
    throw new AppError(motivo, 403, 'SIN_PRECIO_COMPARABLE');
  }
  if (referencia != null && !esAdmin) {
    // En céntimos y con enteros: 899,99 sobre 1000 es un 10,001 % y, redondeado,
    // pasaría por un 10 % que sí cabe. Lo que manda es el importe mínimo.
    const minimo = importeMinimo(referencia, cfg.descuento_max_pct);
    if (Math.round(Number(importe) * 100) < Math.round(minimo * 100)) {
      const sobre = desdeVenta ? `lo pendiente de la venta (${referencia.toFixed(2)} ${mon})` : 'el precio del catálogo';
      throw new AppError(
        cfg.descuento_max_pct > 0
          ? `El descuento máximo en este campus es un ${cfg.descuento_max_pct} % sobre ${sobre}: el importe no puede bajar de ${minimo.toFixed(2)} ${mon}.`
          : `En este campus solo el admin puede hacer descuento sobre ${sobre}.`,
        403, 'DESCUENTO_MAXIMO');
    }
  }
  return {
    moneda: mon, caducidadDias: dias, precioCatalogo: precio, descuentoPct: descuento ?? 0,
    referencia: desdeVenta ? 'pendiente' : 'catalogo', ...(desdeVenta ? { pendiente: Number(pendiente) } : {}),
  };
}

/**
 * La moneda en que sale un link si no se pide otra (CRM#986):
 *   · desde una venta, EUR si el campus lo admite: lo pendiente está en euros y
 *     es contra lo que se mide el link;
 *   · si el curso tiene precio en una moneda que el campus admite, esa: así el
 *     link sale con el precio del curso (y la gestora puede crearlo sin admin);
 *   · si no, la del campus (`moneda_defecto`).
 */
export function monedaPropuesta({ cfg, prod, desdeVenta = false }) {
  const monedas = cfg?.monedas || [];
  if (desdeVenta && monedas.includes('EUR')) return 'EUR';
  const delCurso = prod?.moneda ? String(prod.moneda).trim().toUpperCase() : null;
  if (delCurso && prod.precio != null && Number(prod.precio) > 0 && monedas.includes(delCurso)) return delCurso;
  return cfg?.moneda_defecto || 'EUR';
}

/*
 * CRM#909 (testeo, 18/11): desde una venta se podía crear un link de 400 € con
 * 370 € pendientes; pagado, la venta quedaba cobrada de más. Desde una venta, el
 * link no pasa de lo pendiente, sea quien sea quien lo crea. Lo pendiente está en
 * euros: en otra moneda no se puede comparar y manda `comprobarReglas` (solo el
 * admin). Sin venta (`pendiente` undefined), nada que mirar.
 */
export function noPasaDelPendiente({ importe, moneda, pendiente }) {
  if (pendiente === undefined || pendiente === null) return;
  if (String(moneda || 'EUR').toUpperCase() !== 'EUR') return;
  const p = Number(pendiente);
  if (!(p > 0)) {
    throw new AppError('Esta venta ya está cobrada entera: no queda nada pendiente para un link.', 400, 'LINK_SUPERA_PENDIENTE');
  }
  if (Math.round(Number(importe) * 100) > Math.round(p * 100)) {
    throw new AppError(`El link no puede pasar de lo pendiente de la venta: ${p.toFixed(2)} EUR.`, 400, 'LINK_SUPERA_PENDIENTE');
  }
}

/**
 * El total en `n` cuotas iguales, con los céntimos que sobran en la última:
 * 1000 en 3 → [333.33, 333.33, 333.34]. En céntimos, sin coma flotante.
 */
export function repartirEnCuotas(total, n) {
  const c = Math.round(Number(total) * 100);
  const num = Math.max(1, Math.floor(Number(n) || 1));
  const base = Math.floor(c / num);
  return Array.from({ length: num }, (_, i) => (i === num - 1 ? c - base * (num - 1) : base) / 100);
}

/**
 * Las fechas de `n` cuotas mensuales desde `desde` (AAAA-MM-DD): la primera ese
 * día y cada una el mismo día de los meses siguientes. Un 31 en un mes más corto
 * cae en su último día (31/01 → 28/02 → 31/03).
 */
export function fechasMensuales(desde, n) {
  const [a, m, d] = String(desde).slice(0, 10).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const ultimo = new Date(Date.UTC(a, m + i, 0)).getUTCDate();
    return new Date(Date.UTC(a, m - 1 + i, Math.min(d, ultimo))).toISOString().slice(0, 10);
  });
}

/** El plan de un link en cuotas, desde el día en que se paga la primera. */
export function planDeCuotas({ total, n, desde }) {
  const fechas = fechasMensuales(desde, n);
  return repartirEnCuotas(total, n).map((importe, i) => ({ numero: i + 1, importe, vence: fechas[i] }));
}

/** `a - b` al céntimo, sin coma flotante (900 - 300.1 da 599.9, no 599.900000001). */
export function restaCentimos(a, b) {
  return (Math.round(Number(a) * 100) - Math.round(Number(b) * 100)) / 100;
}

/**
 * INICIAL MÁS CUOTAS (CRM#982): la cuota 1 es la inicial, el día del pago; lo que
 * queda va en `n` cuotas iguales, una al mes desde un mes después, con los
 * céntimos que sobran en la última. 1000 con 250 de inicial en 3 →
 * 250 · 250 · 250 · 250; 1000 con 100 en 7 → 100, 6 × 128,57 y 128,58.
 */
export function planConInicial({ total, inicial, n, desde }) {
  const fechas = fechasMensuales(desde, n + 1);
  return [Number(inicial), ...repartirEnCuotas(restaCentimos(total, inicial), n)]
    .map((importe, i) => ({ numero: i + 1, importe, vence: fechas[i] }));
}

/** Hoy en Madrid, AAAA-MM-DD (las fechas de las cuotas son de calendario). */
export function hoyEnMadrid(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/** Como mucho, tres años entre hoy y la última cuota. */
export const MAX_ANIOS_DEL_PLAN = 3;

/**
 * LAS FECHAS QUE ELIGE LA GESTORA (Diego, 23/11/2026: «crear cuotas y elegir las
 * fechas sí o sí»). Cada cuota después de la inicial lleva su fecha: de mañana en
 * adelante (la inicial es la de hoy, la que cobra el link), cada una después de
 * la anterior y la última a menos de tres años. El orden y la suma los mira Zod.
 */
export function comprobarFechasDelPlan(plan, hoy = hoyEnMadrid()) {
  const fechas = plan.map((c) => String(c.vence).slice(0, 10));
  if (!(fechas[0] > hoy)) {
    throw new AppError('La primera cuota tiene que ir de mañana en adelante: la de hoy es la inicial, la que cobra el link.', 400, 'FECHA_NO_VALIDA');
  }
  const [a, m, d] = hoy.split('-').map(Number);
  const tope = new Date(Date.UTC(a + MAX_ANIOS_DEL_PLAN, m - 1, d)).toISOString().slice(0, 10);
  if (fechas[fechas.length - 1] > tope) {
    throw new AppError(`La última cuota no puede ir a más de ${MAX_ANIOS_DEL_PLAN} años.`, 400, 'FECHA_NO_VALIDA');
  }
}

/**
 * La inicial el día del pago y cada cuota con el importe y la fecha que eligió la
 * gestora (`plan_cuotas` del link, 23/11). Sin `plan`, null.
 */
export function planConFechas({ inicial, plan, desde }) {
  if (!Array.isArray(plan) || !plan.length) return null;
  return [{ numero: 1, importe: Number(inicial), vence: String(desde).slice(0, 10) },
    ...plan.map((c, i) => ({ numero: i + 2, importe: Number(c.importe), vence: String(c.vence).slice(0, 10) }))];
}

/**
 * El plan de la venta de un link en cuotas, desde el día del pago: con las fechas
 * que eligió la gestora (23/11), con inicial (CRM#982) o, los de antes, el total
 * entre `num_cuotas`. null si no es en cuotas.
 */
export function planDelLink(link, desde) {
  if (link.modalidad !== 'cuotas' || !(Number(link.num_cuotas) >= 2)) return null;
  // Con las fechas elegidas al crearlo (23/11), tal cual.
  const conFechas = link.importe_inicial != null ? planConFechas({ inicial: link.importe_inicial, plan: link.plan_cuotas, desde }) : null;
  if (conFechas) return conFechas;
  if (link.importe_inicial != null) {
    return planConInicial({
      total: Number(link.importe), inicial: Number(link.importe_inicial), n: Number(link.num_cuotas) - 1, desde,
    });
  }
  return planDeCuotas({ total: Number(link.importe), n: Number(link.num_cuotas), desde });
}

/**
 * Cuántos días dura el link de una cuota: hasta su vencimiento más la caducidad
 * de serie del campus, sin bajar de esa caducidad.
 *
 * Hasta el 23/11 tampoco pasaba de la máxima del campus (30 días de serie), así
 * que el link de una cuota a tres meses caducaba antes de vencer y había que
 * volver a generarlo. Con las cuotas sin cobro automático (cada una con su link,
 * Diego 23/11) eso dejaba a la alumna sin poder pagar cuando tocaba. La máxima es
 * para los links sueltos; el de una cuota vive hasta su fecha (como mucho, la del
 * plan: tres años, `MAX_ANIOS_DEL_PLAN`).
 */
export function diasDeLaCuota(vence, cfg, hoy = new Date()) {
  const v = new Date(`${String(vence).slice(0, 10)}T00:00:00Z`);
  const h = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate());
  const hasta = Math.max(0, Math.round((v.getTime() - h) / 86400000));
  return Math.min(366 * MAX_ANIOS_DEL_PLAN + cfg.caducidad_dias, Math.max(cfg.caducidad_dias, hasta + cfg.caducidad_dias));
}

/**
 * Las reglas de un link de CUOTA (plan de pago). El importe es el de la cuota,
 * tal cual está en el plan de la venta: no es un descuento y no se mide contra
 * el catálogo. En euros, que es como guarda el CRM las cuotas.
 */
export function reglasDeCuota({ cfg, prod, vence, hoy = new Date() }) {
  if (!cfg.monedas.includes('EUR')) {
    throw new AppError(`Este campus no cobra en EUR, y las cuotas de la venta están en euros. Monedas admitidas: ${cfg.monedas.join(', ')}.`, 400, 'MONEDA_NO_ADMITIDA');
  }
  const precio = prod.precio != null && Number(prod.precio) > 0
    && (!prod.moneda || String(prod.moneda).toUpperCase() === 'EUR') ? Number(prod.precio) : null;
  return {
    moneda: 'EUR', caducidadDias: diasDeLaCuota(vence, cfg, hoy), precioCatalogo: precio,
    descuentoPct: 0, referencia: 'cuota',
  };
}

/** La marca del CRM que va en el link y en el cargo (la lee la fase 3). */
export function marca({ linkId, projectId, leadId, conversionId, userId }) {
  return {
    crm_link_id: String(linkId),
    crm_project_id: String(projectId),
    crm_lead_id: leadId ? String(leadId) : null,
    crm_conversion_id: conversionId ? String(conversionId) : null,
    crm_user_id: String(userId),
    crm_entorno: entorno(),
  };
}

/*
  CUENTAS DE STRIPE COMPARTIDAS. En MultiCRM varios campus pueden compartir una
  cuenta y declaran `filtro_metadata`; allí el link y su cargo llevan además esa
  marca de plataforma (CRM#870) para que el sondeo no los deje «sin marcar». En
  ISEIE cada campus tiene su propia cuenta de Stripe (no hay `filtro_metadata`,
  como dice `disputas.service.js`), así que basta con la marca `crm_*`.
*/

/** Lo que ve el alumno en Stripe junto al curso: qué paga con el link. */
function nombreDeCuotas(enCuotas) {
  if (!enCuotas) return '';
  if (enCuotas.inicial == null) return ` · cuota 1 de ${enCuotas.num}`;
  const n = enCuotas.num - 1;
  return ` · pago inicial (luego ${n} cuota${n === 1 ? '' : 's'} al mes)`;
}

/**
 * Crear el link: se apunta, se crea en Stripe y se completa. Si Stripe falla,
 * la fila se borra: no queda un link sin URL que la gestora pueda mandar.
 */
/*
  `guardaTarjeta` (cobro automático de las cuotas, gemela de CRM 309): `{ consentimiento }`,
  el texto que el alumno ve junto al botón de pagar. El link guarda su tarjeta para
  cobrar solas las cuotas siguientes. Lo decide quien llama, nunca el navegador.
*/
/*
  `enCuotas` (link sencillo en cuotas, 20/11): `{ num, importeCuota }`. El link
  guarda el TOTAL en `importe` (será el total de la venta) y Stripe cobra con él
  solo la primera cuota (`importe_cuota`); va siempre con `guardaTarjeta`.
  Sin prospecto ni venta, Checkout pide también el teléfono.
*/
/*
  `enCuotas.inicial` (CRM-ISEIE#657, gemela de CRM#982): el link cobra la inicial
  (`importeCuota`) y `enCuotas.num` cuenta TODOS los pagos de la venta (la inicial
  y las cuotas). `enCuotas.plan` (23/11): las cuotas de después de la inicial con
  el importe y la fecha que eligió la gestora, `[{ importe, vence }]`; la venta
  nace con ellas. `descuento`: `{ precioOriginal, tipo, valor, importe }`, o null.
  Se guarda en el link y, al pagarse, en la venta.
*/
/*
  `codigosPromo` (CRM#986): el alumno puede escribir un código promocional de
  Stripe al pagar. Lo decide el controlador (solo pago único y si el campus lo
  admite); lo que descontó se apunta al pagarse (links-pago.codigos.js).
*/
export async function crear({ projectId, leadId, conversionId, prod, reglas, importe, userId, cuota = null, guardaTarjeta = null, enCuotas = null, descuento = null, codigosPromo = false }) {
  const clave = await claveObligatoria(projectId);
  const fila = await model.insertar({
    projectId, leadId, conversionId, productId: prod.id, createdBy: userId,
    precioCatalogo: reglas.precioCatalogo, importe, descuentoPct: reglas.descuentoPct,
    moneda: reglas.moneda, caducidadDias: reglas.caducidadDias, installmentId: cuota?.id ?? null,
    guardaTarjeta: !!guardaTarjeta,
    codigosPromo: !!codigosPromo,
    ...(enCuotas ? {
      numCuotas: enCuotas.num, importeCuota: enCuotas.importeCuota, importeInicial: enCuotas.inicial ?? null,
      planCuotas: enCuotas.plan ?? null,
    } : {}),
    ...(descuento ? {
      precioOriginal: descuento.precioOriginal, descuentoTipo: descuento.tipo,
      descuentoValor: descuento.valor, descuentoImporte: descuento.importe,
    } : {}),
  });
  const sinPersona = !leadId && !conversionId;
  const meta = marca({ linkId: fila.id, projectId, leadId, conversionId, userId });
  // Única por link y por entorno: /staging y local pueden compartir cuenta de test.
  const base = `crm-${meta.crm_entorno}-link-${fila.id}-${new Date(fila.created_at).getTime()}`;
  let precio; let link;
  try {
    precio = await stripe.crearPrecio(clave, {
      importe: enCuotas ? enCuotas.importeCuota : importe, moneda: reglas.moneda, metadata: meta,
      // El alumno ve en Stripe qué cuota paga.
      nombre: `${prod.nombre || `Curso ${prod.id}`}${cuota ? ` · cuota ${cuota.numero}` : ''}${nombreDeCuotas(enCuotas)}`,
      idempotencia: `${base}-precio`,
    });
    link = await stripe.crearLink(clave, {
      priceId: precio.id, metadata: meta, idempotencia: `${base}-link`, guardaTarjeta, pedirTelefono: sinPersona,
      codigosPromo: !!codigosPromo,
    });
  } catch (err) {
    await model.borrar(fila.id).catch((e) => logger.error({ err: e.message, linkId: fila.id }, 'Links de pago: no se pudo borrar la fila de un link fallido'));
    logger.warn({ err: err.message, projectId, userId }, 'Links de pago: Stripe no creó el link');
    throw errorDeStripe(err, 'crear el link');
  }
  try {
    await model.completarConStripe(fila.id, { url: link.url, paymentLinkId: link.id, priceId: precio.id });
  } catch (err) {
    // El link existe en Stripe pero el CRM no lo ha podido guardar: se apaga allí
    // para que nadie pueda pagar un link que el CRM no conoce.
    logger.error({ err: err.message, linkId: fila.id, paymentLinkId: link.id }, 'Links de pago: no se pudo guardar el link creado; se desactiva en Stripe');
    await stripe.desactivarLink(clave, link.id).catch((e) => logger.error({ err: e.message, paymentLinkId: link.id }, 'Links de pago: TAMPOCO se pudo desactivar en Stripe; hay que hacerlo a mano'));
    await model.borrar(fila.id).catch(() => {});
    throw err;
  }
  await model.anotarEvento(fila.id, 'creado', {
    por: userId, importe, moneda: reglas.moneda, descuento_pct: reglas.descuentoPct,
    caduca_el: fila.caduca_el, stripe_payment_link_id: link.id,
    // Contra qué se midió el descuento (fase 3): el catálogo, o lo pendiente de la venta.
    descuento_sobre: cuota ? 'cuota' : (reglas.referencia || 'catalogo'),
    ...(cuota ? { cuota_id: cuota.id, cuota_numero: cuota.numero, cuota_vence: cuota.vence } : {}),
    ...(guardaTarjeta ? { guarda_tarjeta: true } : {}),
    ...(enCuotas ? { num_cuotas: enCuotas.num, importe_cuota: enCuotas.importeCuota } : {}),
    ...(enCuotas?.inicial != null ? { importe_inicial: enCuotas.inicial } : {}),
    ...(enCuotas?.plan ? { plan_cuotas: enCuotas.plan, cobro_automatico: !!guardaTarjeta } : {}),
    ...(descuento ? {
      precio_original: descuento.precioOriginal, descuento_tipo: descuento.tipo,
      descuento_valor: descuento.valor, descuento_importe: descuento.importe,
    } : {}),
    ...(sinPersona ? { sin_prospecto: true } : {}),
    ...(codigosPromo ? { codigos_promo: true } : {}),
    ...(reglas.pendiente !== undefined ? { pendiente: reglas.pendiente } : {}),
  });
  logger.info({ linkId: fila.id, projectId, userId, importe, moneda: reglas.moneda }, 'Links de pago: link creado');
  return model.porId(fila.id);
}

/**
 * UN LINK POR CUOTA (plan de pago, 19/11; y cuotas sin cobro automático, 23/11).
 * Para cada cuota pendiente de la venta sin link vivo, un link con su importe que
 * caduca según su fecha (`reglasDeCuota`). Al pagarlo, el cobro salda ESA cuota.
 * Devuelve los ids de los links creados.
 */
export async function crearLinksDeCuotas({ projectId, leadId, conversionId, prod, cfg, userId, cuotas, guardaTarjeta = null }) {
  const creados = [];
  for (const c of cuotas.filter((x) => !x.link_id)) {
    const reglas = reglasDeCuota({ cfg, prod, vence: c.vence });
    const link = await crear({
      projectId, leadId, conversionId, prod, reglas, importe: Number(c.importe), userId,
      cuota: { id: c.id, numero: c.numero, vence: c.vence }, guardaTarjeta,
    });
    creados.push(Number(link.id));
  }
  return creados;
}

/**
 * Anular un link que no se ha pagado: primero se desactiva en Stripe (si no, el
 * cliente podría pagarlo igual) y luego se marca. Lo pagado no se anula: se
 * devuelve, y eso lo hace una persona en Stripe.
 */
export async function anular(link, { userId, motivo }) {
  if (!['creado', 'abierto'].includes(link.estado)) {
    throw new AppError(`Un link ${link.estado.replace('_', ' ')} no se puede anular.`, 409, 'NO_ANULABLE');
  }
  if (link.stripe_payment_link_id) {
    const clave = await claveObligatoria(link.project_id);
    try { await stripe.desactivarLink(clave, link.stripe_payment_link_id); }
    catch (err) { throw errorDeStripe(err, 'desactivar el link'); }
  }
  const hecho = await model.marcarAnulado(link.id, { userId, motivo });
  if (!hecho) throw new AppError('El link ha cambiado mientras tanto (pagado o caducado). Recarga.', 409, 'NO_ANULABLE');
  await model.anotarEvento(link.id, 'anulado', { por: userId, motivo });
  logger.info({ linkId: link.id, userId }, 'Links de pago: link anulado');
  return model.porId(link.id);
}

/**
 * El cron: los vivos con la fecha pasada se desactivan en Stripe y se marcan
 * caducados. Si Stripe falla o el campus ya no tiene clave, se deja como está y
 * se reintenta en la siguiente vuelta: marcarlo sin desactivarlo dejaría un link
 * que se puede pagar con el CRM diciendo «caducado».
 */
export async function caducarVencidos({ lote = 50 } = {}) {
  const vencidos = await model.porCaducar(lote);
  const res = { caducados: 0, pendientes: 0 };
  for (const l of vencidos) {
    try {
      if (l.stripe_payment_link_id) {
        const clave = await claveDeEscritura(l.project_id);
        if (!clave) {
          logger.warn({ linkId: l.id, projectId: l.project_id }, 'Links de pago: no se puede caducar, el campus no tiene la clave de links');
          res.pendientes += 1;
          continue;
        }
        await stripe.desactivarLink(clave, l.stripe_payment_link_id);
      }
      if (await model.marcarCaducado(l.id)) {
        await model.anotarEvento(l.id, 'caducado', { por: 'cron' });
        res.caducados += 1;
      }
    } catch (err) {
      logger.warn({ err: err.message, linkId: l.id }, 'Links de pago: no se pudo caducar; se reintenta en la siguiente vuelta');
      res.pendientes += 1;
    }
  }
  if (vencidos.length) logger.info(res, 'Links de pago: vuelta de caducidad');
  return res;
}

// ─── El webhook de la cuenta (Integraciones › Links de pago) ────────────────

/*
  Los eventos que necesitan los links: el pago (fase 3), los intentos fallidos y
  la caducidad de la sesión, y las cuotas (fase 4). Se AÑADEN a los que ya
  escucha el webhook (cargos, disputas, payment_intent): no se quita ninguno.
  Stripe no acepta comodines parciales por la API («checkout.session.*»), así
  que van uno a uno.
*/
export const EVENTOS_DE_LOS_LINKS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.deleted',
];

/**
 * El webhook que se creó el 16/11 para la cuenta del campus: su id está en la
 * integración «Stripe» (`config_public.webhook_endpoint_id`), junto a su
 * secreto cifrado. Se reutiliza ese: el CRM nunca crea otro, porque el secreto
 * de uno nuevo no se podría guardar sin pasar por el panel de Stripe.
 */
export async function idDelWebhook(projectId) {
  const row = await integrationsModel.get(projectId, 'stripe');
  const id = row?.config_public?.webhook_endpoint_id;
  return typeof id === 'string' && /^we_[A-Za-z0-9]{6,}$/.test(id) ? id : null;
}

function resumenWebhook(we, endpointId, comparten) {
  const eventos = Array.isArray(we.enabled_events) ? we.enabled_events : [];
  const todos = eventos.includes('*');
  return {
    vinculado: true,
    endpoint_id: endpointId,
    activo: we.status === 'enabled',
    url: we.url || null,
    eventos,
    faltan: todos ? [] : EVENTOS_DE_LOS_LINKS.filter((e) => !eventos.includes(e)),
    comparten,
  };
}

export async function verWebhook(projectId, { campusVisibles = null } = {}) {
  const endpointId = await idDelWebhook(projectId);
  if (!endpointId) return { vinculado: false, faltan: EVENTOS_DE_LOS_LINKS };
  const clave = await claveObligatoria(projectId);
  let we;
  try { we = await stripe.verWebhook(clave, endpointId); }
  catch (err) {
    if (err instanceof stripe.ErrorDeStripe && err.status === 404) {
      return { vinculado: true, endpoint_id: endpointId, existe: false, faltan: EVENTOS_DE_LOS_LINKS };
    }
    throw errorDeStripe(err, 'leer el webhook');
  }
  const comparten = await model.campusDelWebhook(endpointId, campusVisibles);
  return { existe: true, ...resumenWebhook(we, endpointId, comparten) };
}

/**
 * Añadir los eventos que faltan, activar o desactivar. Es de la CUENTA: si
 * varios campus la comparten, les afecta a todos (la tarjeta lo dice).
 */
export async function cambiarWebhook(projectId, accion, { campusVisibles = null } = {}) {
  const endpointId = await idDelWebhook(projectId);
  if (!endpointId) {
    throw new AppError('Este campus no tiene webhook de Stripe vinculado (falta su id en la tarjeta «Stripe»). No se crea uno nuevo.',
      409, 'SIN_WEBHOOK');
  }
  const clave = await claveObligatoria(projectId);
  try {
    let cambios;
    if (accion === 'anadir_eventos') {
      const we = await stripe.verWebhook(clave, endpointId);
      const actuales = Array.isArray(we.enabled_events) ? we.enabled_events : [];
      if (actuales.includes('*') || EVENTOS_DE_LOS_LINKS.every((e) => actuales.includes(e))) {
        return { cambiado: false, ...(await verWebhook(projectId, { campusVisibles })) };
      }
      // Stripe sustituye la lista: van los que había más los nuevos.
      cambios = { eventos: [...new Set([...actuales, ...EVENTOS_DE_LOS_LINKS])] };
    } else {
      cambios = { desactivado: accion === 'desactivar' };
    }
    const we = await stripe.actualizarWebhook(clave, endpointId, cambios);
    const comparten = await model.campusDelWebhook(endpointId, campusVisibles);
    return { cambiado: true, existe: true, ...resumenWebhook(we, endpointId, comparten) };
  } catch (err) {
    throw errorDeStripe(err, 'cambiar el webhook');
  }
}
