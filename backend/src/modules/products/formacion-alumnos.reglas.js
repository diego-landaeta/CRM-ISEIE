import { tipoPorNombre } from '../cursos-pendientes/cursos-pendientes.venta.js';

/**
 * Formaciones · alumnos activos (CRM-ISEIE#767, gemela de CRM#1113): las reglas, sin base.
 *
 * Un ALUMNO de una formación es quien tiene una venta de ella (el producto de la
 * venta o el de una de sus líneas). Está:
 *   · FUERA si todas sus ventas de esa formación están anuladas (facturas
 *     anuladas con su abono y ninguna vigente) o devueltas (devoluciones por
 *     todo lo cobrado). El CRM no guarda bajas ni desistimientos de alumnos
 *     aparte: anular la factura o devolver es como se apuntan hoy (las
 *     suspensiones de Moodle son CRM#531, en espera).
 *   · ACTIVO si su acceso sigue vigente hoy (fin del acceso >= hoy).
 *   · TERMINADO si ya pasó.
 *
 * El fin del acceso (`finDeAcceso`), en este orden: la fecha de fin de la
 * formación; su duración publicada (la de la web) desde el inicio del alumno o
 * la venta; la regla del campus para su tipo; la de serie.
 *
 * El estado de pago (`estadoDePago`) de cada venta: IMPAGO si tiene una cuota
 * vencida sin cobrar (o, sin cuotas, el compromiso de pago vencido con algo por
 * cobrar, o la suscripción de Stripe en mora); PENDIENTE si le queda algo por
 * cobrar sin nada vencido; AL DÍA si no debe nada.
 */

export const TIPOS = ['curso', 'diplomado', 'master'];

/** La regla de serie, en meses: lo que dura de verdad lo publicado (curso 1-2, diplomado 6, máster 12), con margen en el curso. */
export const MESES_DE_SERIE = Object.freeze({ curso: 3, diplomado: 6, master: 12 });

/** La regla del campus: lo guardado encima de la de serie. Solo enteros de 1 a 120. */
export function reglaDelCampus(guardada) {
  const g = guardada && typeof guardada === 'object' ? guardada : {};
  const regla = {};
  let configurada = false;
  for (const t of TIPOS) {
    const n = Number(g[t]);
    if (Number.isInteger(n) && n >= 1 && n <= 120) { regla[t] = n; configurada = true; } else regla[t] = MESES_DE_SERIE[t];
  }
  return { ...regla, configurada };
}

const numero = (s) => Number(String(s).replace(',', '.'));

/**
 * La duración publicada de una formación («2 meses», «6-7 meses», «1 año»,
 * «4 semanas», «12», «1.5») → { meses, dias }. En un rango, lo más largo. Un
 * número solo son meses (hasta 36). Las horas no son duración: null.
 */
export function duracionDeTexto(texto) {
  const t = String(texto || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  if (!t || /hora/.test(t)) return null;
  const m = t.match(/(\d+(?:[.,]\d+)?)(?:\s*(?:-|a|o|y|\/)\s*(\d+(?:[.,]\d+)?))?\s*(mes(?:es)?|semanas?|anos?|anios?|dias?)?/);
  if (!m) return null;
  const n = Math.max(numero(m[1]), m[2] ? numero(m[2]) : 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unidad = m[3] || '';
  if (/^an/.test(unidad)) return partir(n * 12);
  if (/^semana/.test(unidad)) return { meses: 0, dias: Math.round(n * 7) };
  if (/^dia/.test(unidad)) return { meses: 0, dias: Math.round(n) };
  if (!unidad && n > 36) return null;
  return partir(n);
}

function partir(meses) {
  const enteros = Math.floor(meses);
  return { meses: enteros, dias: Math.round((meses - enteros) * 30) };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const aISO = (d) => d.toISOString().slice(0, 10);

/** «AAAA-MM-DD» + meses y días. Del 31 al mes corto, su último día (31/01 + 1 mes = 28/02). */
export function sumarDuracion(fecha, { meses = 0, dias = 0 }) {
  if (!ISO.test(String(fecha || ''))) return null;
  const [y, mo, d] = fecha.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, mo - 1 + meses + 1, 0)).getUTCDate();
  const base = new Date(Date.UTC(y, mo - 1 + meses, Math.min(d, ultimo)));
  base.setUTCDate(base.getUTCDate() + dias);
  return aISO(base);
}

export const fechaISO = (d) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** El tipo de la formación: el guardado o, sin él, el que se adivina por el nombre (como en la ficha). */
export const tipoDe = (producto) => producto?.tipo_formacion || tipoPorNombre(producto?.nombre);

/**
 * Hasta cuándo tiene acceso el alumno a la formación, y de dónde sale.
 *   inicio   «AAAA-MM-DD»: el inicio pactado o, sin él, el día de la venta.
 *   producto { nombre, tipo_formacion, duracion, fecha_fin }
 *   regla    la del campus (`reglaDelCampus`).
 * → { fin, origen: 'fin_formacion'|'duracion'|'regla_campus'|'regla_de_serie', detalle }
 */
export function finDeAcceso({ inicio, producto, regla }) {
  const finFormacion = fechaISO(producto?.fecha_fin);
  // Una fecha de fin anterior al inicio del alumno es de otra edición: no vale para él.
  if (finFormacion && (!inicio || finFormacion >= inicio)) {
    return { fin: finFormacion, origen: 'fin_formacion', detalle: 'Fin de la formación' };
  }
  if (!inicio) return { fin: null, origen: null, detalle: 'Sin fecha de venta' };
  const dur = duracionDeTexto(producto?.duracion);
  if (dur) {
    return { fin: sumarDuracion(inicio, dur), origen: 'duracion', detalle: `Duración de la formación: ${String(producto.duracion).trim()}` };
  }
  const tipo = tipoDe(producto);
  const r = regla || reglaDelCampus(null);
  const meses = r[tipo] ?? MESES_DE_SERIE[tipo];
  const nombre = { curso: 'curso', diplomado: 'diplomado', master: 'máster' }[tipo];
  return {
    fin: sumarDuracion(inicio, { meses, dias: 0 }),
    origen: r.configurada ? 'regla_campus' : 'regla_de_serie',
    detalle: `${r.configurada ? 'Regla del campus' : 'Regla de serie'}: ${nombre}, ${meses} ${meses === 1 ? 'mes' : 'meses'}`,
  };
}

const CENTIMO = 0.005;

/**
 * El estado de pago de una venta, el día `hoy`.
 *   v = { importe_total, cobrado, con_cuotas, cuota_vencida, cuota_pendiente,
 *         fecha_compromiso_pago, suscripcion_estado }
 * → 'impago' | 'pendiente' | 'al_dia'
 */
export function estadoDePago(v, hoy) {
  const total = Number(v.importe_total) || 0;
  const cobrado = Number(v.cobrado) || 0;
  const debe = cobrado < total - CENTIMO;
  const compromiso = fechaISO(v.fecha_compromiso_pago);
  if (v.cuota_vencida) return 'impago';
  if (['past_due', 'unpaid'].includes(String(v.suscripcion_estado || ''))) return 'impago';
  if (!v.con_cuotas && debe && compromiso && compromiso < hoy) return 'impago';
  if (debe || v.cuota_pendiente) return 'pendiente';
  return 'al_dia';
}

const PEOR = { al_dia: 0, pendiente: 1, impago: 2 };

/** Por qué una venta no cuenta: anulada o devuelta. null si cuenta. */
export function motivoFuera(v) {
  if (v.anulada) return 'anulada';
  const devuelto = Number(v.devuelto) || 0;
  if (devuelto > 0 && devuelto >= (Number(v.cobrado) || 0) - CENTIMO) return 'devuelta';
  return null;
}

/**
 * Los alumnos de UNA formación a partir de sus ventas (las que la llevan).
 * Un alumno es una ficha (`lead_id`); con dos ventas de la misma formación, su
 * acceso es el más largo y su pago, el peor de los dos.
 */
export function alumnosDeVentas(ventas, producto, regla, hoy) {
  const porAlumno = new Map();
  for (const v of ventas) {
    const clave = v.lead_id ? `l${v.lead_id}` : `v${v.id}`;
    const inicio = fechaISO(v.fecha_inicio) || fechaISO(v.fecha_conversion);
    const acceso = finDeAcceso({ inicio, producto, regla });
    const fuera = motivoFuera(v);
    const venta = {
      id: Number(v.id),
      fecha_venta: fechaISO(v.fecha_conversion),
      inicio,
      ...acceso,
      fuera,
      pago: fuera ? null : estadoDePago(v, hoy),
    };
    const a = porAlumno.get(clave) || {
      lead_id: v.lead_id ? Number(v.lead_id) : null,
      nombre: v.alumno || null,
      email: v.email || null,
      gestora: v.gestora || null,
      ventas: [],
    };
    a.ventas.push(venta);
    porAlumno.set(clave, a);
  }

  return [...porAlumno.values()].map((a) => {
    const vigentes = a.ventas.filter((v) => !v.fuera);
    const cuentan = vigentes.length ? vigentes : a.ventas;
    // La venta que manda: la de acceso más largo (sin fin, la más reciente).
    const manda = [...cuentan].sort((x, y) => (y.fin || '').localeCompare(x.fin || '') || y.id - x.id)[0];
    const pago = vigentes.length
      ? vigentes.map((v) => v.pago).sort((x, y) => PEOR[y] - PEOR[x])[0]
      : null;
    let estado;
    if (!vigentes.length) estado = 'fuera';
    else estado = manda.fin && manda.fin >= hoy ? 'activo' : 'terminado';
    return {
      lead_id: a.lead_id,
      nombre: a.nombre,
      email: a.email,
      gestora: a.gestora,
      venta_id: manda.id,
      ventas: a.ventas.map((v) => v.id),
      fecha_venta: manda.fecha_venta,
      inicio: manda.inicio,
      fin_acceso: manda.fin,
      origen_fin: manda.origen,
      detalle_fin: manda.detalle,
      estado,
      motivo_fuera: estado === 'fuera' ? manda.fuera : null,
      pago,
    };
  });
}

/** Las cifras de una lista de alumnos (las de pago, de los activos). */
export function resumenDeAlumnos(alumnos) {
  const r = { activos: 0, terminados: 0, total: 0, fuera: 0, al_dia: 0, pendiente: 0, impago: 0 };
  for (const a of alumnos) {
    if (a.estado === 'fuera') { r.fuera += 1; continue; }
    r.total += 1;
    if (a.estado === 'terminado') { r.terminados += 1; continue; }
    r.activos += 1;
    r[a.pago] += 1;
  }
  return r;
}

const ORDEN_ESTADO = { activo: 0, terminado: 1, fuera: 2 };

/** La lista como se enseña: activos primero (con impago arriba), luego terminados y fuera; dentro, por fin de acceso. */
export function ordenarAlumnos(alumnos) {
  return [...alumnos].sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado]
    || (PEOR[b.pago] ?? -1) - (PEOR[a.pago] ?? -1)
    || (a.fin_acceso || '').localeCompare(b.fin_acceso || '')
    || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
}

/** Hoy en Madrid, «AAAA-MM-DD» (la oficina, como en Ventas). */
export const hoyEnMadrid = (ahora = new Date()) => ahora.toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid' });
