/**
 * EXTRACTOS DEL BANCO → CRM (#766, Automatizaciones 3/9).
 *
 * El Santander no da una API abierta para leer los cobros, así que entran por
 * extracto: Norma 43 o el CSV de la banca online, subido desde el panel. De cada
 * ABONO (los cargos no interesan) el CRM propone la venta por importe y por
 * nombre en el concepto:
 *
 *   · Candidatos: las ventas del campus cuyo cliente sale nombrado en el
 *     concepto. Si ninguna, las que esperan justo ese importe (lo pendiente, la
 *     próxima cuota o el total sin cobrar nada aún): solo para revisar.
 *   · Se enlaza SOLO si hay UN candidato y coinciden a la vez el nombre y el
 *     importe. Con más de uno, o con uno que no casa en las dos cosas, queda
 *     «a revisar» y lo decide una persona. Nada se enlaza solo con dos.
 *   · Las liquidaciones de Stripe o PayPal al banco no son cobros de una venta
 *     (cada cobro ya entró por su lado): se apartan solas como descartadas.
 *
 * El cobro se registra con `origen='santander'` y la huella del movimiento: el
 * mismo abono que aparece en dos extractos que se solapan entra una vez, y si
 * alguien ya lo había apuntado a mano se engancha a ese en vez de sumar otro.
 *
 * Todo detrás de SANTANDER_EXTRACTOS_ACTIVO=1.
 */
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import * as model from './extracto.model.js';
import { leerExtracto, huellas, huellaDelFichero } from './extracto.parser.js';
import { registrarCobroExterno, normalizarTexto } from './enlace.js';

const CENT = 0.01;
const casa = (a, b) => b != null && Math.abs(Number(a) - Number(b)) < CENT;
// Palabras del nombre que no dicen nada de quién es.
const VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa', 'maria', 'jose']);
const LIQUIDACION = /\b(stripe|paypal)\b/i;

/** Las palabras que identifican un nombre: tres letras o más, sin las vacías. */
function palabrasDelNombre(nombre) {
  return [...new Set(normalizarTexto(nombre).split(' ').filter((p) => p.length >= 3 && !VACIAS.has(p)))];
}

/**
 * ¿Sale el cliente en el concepto? Con dos palabras de su nombre (o la única
 * que tenga, si solo tiene una que sirva).
 */
export function nombreEnConcepto(nombre, concepto) {
  const palabras = palabrasDelNombre(nombre);
  if (!palabras.length) return false;
  const texto = ` ${normalizarTexto(concepto)} `;
  const halladas = palabras.filter((p) => texto.includes(` ${p} `)).length;
  return halladas >= Math.min(2, palabras.length);
}

/** ¿Es el importe que espera esta venta? */
export function importeEsperado(importe, venta) {
  const total = Number(venta.importe_total);
  const cobrado = Number(venta.cobrado);
  const pendiente = total - cobrado;
  return (pendiente > CENT && casa(importe, pendiente))
    || casa(importe, venta.proxima_cuota)
    || (cobrado < CENT && casa(importe, total));
}

/**
 * Los candidatos de un abono entre las ventas del campus. Puro: sin base.
 * Devuelve `{ estado, candidatos, conversionId }`; `conversionId` solo cuando
 * se puede enlazar solo.
 */
export function proponerVenta(mov, ventas) {
  if (LIQUIDACION.test(mov.concepto || '')) return { estado: 'descartado', candidatos: [], liquidacion: true };
  const resumen = (v, motivos) => ({
    conversion_id: v.id, lead_id: v.lead_id, nombre: v.nombre, producto: v.producto_contratado,
    pendiente: Number((Number(v.importe_total) - Number(v.cobrado)).toFixed(2)), motivos,
  });
  const porNombre = ventas.filter((v) => nombreEnConcepto(v.nombre, mov.concepto));
  let candidatos;
  if (porNombre.length) {
    candidatos = porNombre.map((v) => resumen(v, importeEsperado(mov.importe, v) ? ['nombre', 'importe'] : ['nombre']));
  } else {
    candidatos = ventas.filter((v) => importeEsperado(mov.importe, v)).map((v) => resumen(v, ['importe']));
  }
  // Los mejores primero; para revisar bastan diez.
  candidatos.sort((a, b) => b.motivos.length - a.motivos.length || a.conversion_id - b.conversion_id);
  const total = candidatos.length;
  candidatos = candidatos.slice(0, 10);
  if (total === 1 && candidatos[0].motivos.length === 2) {
    return { estado: 'enlazar', candidatos, conversionId: candidatos[0].conversion_id };
  }
  return { estado: total ? 'a_revisar' : 'sin_candidato', candidatos, totalCandidatos: total };
}

/**
 * Enlaza un movimiento con una venta, de uno en uno (la reserva de la #699).
 * `linkMethod`: 'auto' (lo decidió el CRM) o 'manual' (una persona).
 */
export async function enlazarMovimiento(movId, conversionId, { userId = null, linkMethod = 'auto' } = {}) {
  const reservado = await model.reservar(movId);
  if (!reservado) return { error: 'OCUPADO' };
  try {
    const res = await registrarCobroExterno({
      conversionId,
      origen: 'santander',
      ref: reservado.huella,
      importe: Number(reservado.importe),
      fecha: new Date(reservado.fecha_operacion).toISOString().slice(0, 10),
      notas: `Banco ${reservado.cuenta || ''} · ${String(reservado.concepto || '').slice(0, 120)}`.trim(),
      metodo: 'transferencia',
      referencia: reservado.referencia || null,
      // Una transferencia se apunta a mano cuando el cliente manda el
      // justificante, días antes de que salga en el extracto.
      diasMargen: 7,
    });
    if (!res) return { error: 'NOT_FOUND' };
    await model.marcarEnlazado(movId, {
      conversionId: res.conversionId ?? conversionId,
      paymentId: res.paymentId,
      linkMethod: res.metodo === 'nuevo' ? linkMethod : `${linkMethod}_dedup`,
      userId,
    });
    return { paymentId: res.paymentId, metodo: res.metodo };
  } finally {
    await model.soltar(movId, reservado.estado_antes).catch((e) => logger.error(
      { movId, err: e.message }, 'banco: no se pudo soltar la reserva del movimiento; caduca sola en 2 minutos'));
  }
}

/**
 * Subir un extracto. Devuelve el resumen de lo que ha pasado con cada abono.
 * Lanza `{ code: 'YA_SUBIDO' }` si ese mismo fichero ya se subió en el campus.
 */
export async function importarExtracto({ projectId, buffer, nombre, userId }) {
  const leido = leerExtracto(buffer);
  const abonos = leido.movimientos.filter((m) => m.importe > 0);
  const enEuros = abonos.filter((m) => (m.moneda || 'EUR') === 'EUR');
  const extracto = await model.crearExtracto({
    projectId, formato: leido.formato, nombre, huella: huellaDelFichero(buffer), cuenta: leido.cuenta,
    desde: leido.desde, hasta: leido.hasta, movimientos: leido.movimientos.length, abonos: abonos.length, userId,
  });
  if (!extracto) {
    const e = new Error('Este extracto ya se subió en este campus.');
    e.code = 'YA_SUBIDO';
    throw e;
  }

  const ventas = await model.ventasDelCampus(projectId);
  const marcas = huellas(projectId, enEuros);
  const resumen = { extractoId: extracto.id, formato: leido.formato, movimientos: leido.movimientos.length,
    abonos: abonos.length, otraMoneda: abonos.length - enEuros.length, nuevos: 0, repetidos: 0,
    enlazados: 0, yaApuntados: 0, aRevisar: 0, sinCandidato: 0, liquidaciones: 0 };

  for (let i = 0; i < enEuros.length; i++) {
    const m = enEuros[i];
    const mov = await model.crearMovimiento({ ...m, extractoId: extracto.id, projectId, huella: marcas[i] });
    if (!mov) { resumen.repetidos++; continue; }
    resumen.nuevos++;
    const p = proponerVenta({ importe: Number(mov.importe), concepto: mov.concepto }, ventas);
    try {
      if (p.estado === 'enlazar') {
        const r = await enlazarMovimiento(mov.id, p.conversionId, { linkMethod: 'auto' });
        if (r.error) { await model.proponer(mov.id, { estado: 'a_revisar', candidatos: p.candidatos }); resumen.aRevisar++; continue; }
        await query('UPDATE movimientos_banco SET candidatos = $2::jsonb WHERE id = $1', [mov.id, JSON.stringify(p.candidatos)]);
        if (r.metodo === 'nuevo') resumen.enlazados++; else resumen.yaApuntados++;
      } else if (p.liquidacion) {
        await model.proponer(mov.id, { estado: 'descartado', candidatos: [], linkMethod: 'auto_liquidacion' });
        resumen.liquidaciones++;
      } else {
        await model.proponer(mov.id, { estado: p.estado, candidatos: p.candidatos });
        if (p.estado === 'a_revisar') resumen.aRevisar++; else resumen.sinCandidato++;
      }
    } catch (e) {
      logger.warn({ projectId, movId: mov.id, err: e.message }, 'banco: un abono no se pudo proponer; queda a revisar');
      await model.proponer(mov.id, { estado: 'a_revisar', candidatos: p.candidatos || [] }).catch(() => {});
      resumen.aRevisar++;
    }
  }
  await model.cerrarExtracto(extracto.id, {
    abonosNuevos: resumen.nuevos, enlazados: resumen.enlazados + resumen.yaApuntados, aRevisar: resumen.aRevisar,
  });
  logger.info({ projectId, ...resumen }, 'extracto del banco importado');
  return resumen;
}

/** Una persona confirma la venta de un abono (de la lista de candidatos o cualquiera del campus). */
export async function confirmar(movId, conversionId, userId) {
  const mov = await model.getMovimiento(movId);
  if (!mov) return { error: 'NOT_FOUND' };
  if (mov.conversion_payment_id) return { error: 'YA_ENLAZADO' };
  const { rows: [v] } = await query('SELECT project_id FROM conversions WHERE id = $1', [conversionId]);
  if (!v || Number(v.project_id) !== Number(mov.project_id)) return { error: 'VENTA_DE_OTRO_CAMPUS' };
  return enlazarMovimiento(movId, conversionId, { userId, linkMethod: 'manual' });
}
