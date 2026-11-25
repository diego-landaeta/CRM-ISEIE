import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { COBRADO_DE } from './cobrado.js';
import { textoMotivoBaja } from './baja-alumno.motivos.js';

/*
  LA BAJA DEL ALUMNO EN LA VENTA (sobre CRM#1113 / CRM-ISEIE#767, alumnos activos).

  Diego, 25/11/2026: «Dar de baja al alumno» en la ficha de la venta, con fecha,
  motivo y nota. Desde esa fecha la venta deja de contar como activa en
  Productos › Formaciones › Alumnos (formacion-alumnos.reglas.js).

  Lo que NO hace, a propósito:
    · no anula facturas ni toca cobros, cuotas ni el cobro automático: si quedan
      cuotas por cobrar, solo lo AVISA (`avisos`) para que se decida aparte;
    · no da de baja en Moodle: lo hacen las tutoras o Make;
    · no es CRM#531 (impagos y suspensiones de Make), que sigue en espera.

  Se puede deshacer. Cada baja, cambio y «deshacer» queda en
  `conversion_bajas_historial` con quién y cuándo, y una nota en la ficha del
  cliente (`lead_interactions`), como el reparto de la venta.

  Sin la migración 341 (330 en el 360) la lectura dice `disponible: false` y la
  escritura responde 503: la ficha de la venta no se rompe.
*/

const SIN_COLUMNA = '42703';
const SIN_TABLA = '42P01';
const sinMigracion = (err) => err?.code === SIN_COLUMNA || err?.code === SIN_TABLA;
const NO_DISPONIBLE = () => new AppError('La baja del alumno aún no está instalada en este CRM (falta la migración)', 503, 'BAJA_NO_DISPONIBLE');

const fechaISO = (d) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/** Lo que queda por cobrar y lo que sigue cobrándose solo: para avisar, no para tocarlo. */
async function avisosDe(conversionId) {
  const { rows: [a] } = await query(
    `SELECT (SELECT COUNT(*)::int FROM conversion_installments i
              WHERE i.conversion_id = c.id AND i.fecha_cobro IS NULL) AS cuotas_pendientes,
            (SELECT COALESCE(SUM(i.importe_previsto), 0) FROM conversion_installments i
              WHERE i.conversion_id = c.id AND i.fecha_cobro IS NULL) AS importe_cuotas_pendientes,
            GREATEST(COALESCE(c.importe_total, 0) - ${COBRADO_DE('c')}, 0) AS pendiente,
            c.suscripcion_estado
       FROM conversions c WHERE c.id = $1`,
    [conversionId]
  );
  let cobroAutomatico = false;
  try {
    const { rows: [ca] } = await query('SELECT activo FROM conversion_cobro_auto WHERE conversion_id = $1', [conversionId]);
    cobroAutomatico = Boolean(ca?.activo);
  } catch (err) { if (err?.code !== SIN_TABLA) throw err; }
  return {
    cuotas_pendientes: Number(a?.cuotas_pendientes || 0),
    importe_cuotas_pendientes: Number(a?.importe_cuotas_pendientes || 0),
    pendiente: Math.round(Number(a?.pendiente || 0) * 100) / 100,
    cobro_automatico: cobroAutomatico,
    suscripcion_activa: ['active', 'trialing', 'past_due'].includes(String(a?.suscripcion_estado || '')),
  };
}

const conTexto = (b) => (b ? { ...b, motivo_texto: textoMotivoBaja(b.motivo) } : null);

/** La baja de la venta (o null), su historial y los avisos de cobro. */
export async function leerBaja(conversionId) {
  let venta;
  let historial;
  try {
    ({ rows: [venta] } = await query(
      `SELECT c.id, c.baja_fecha, c.baja_motivo, c.baja_nota, c.baja_at, u.nombre AS baja_por_nombre
         FROM conversions c LEFT JOIN users u ON u.id = c.baja_por
        WHERE c.id = $1`,
      [conversionId]
    ));
    ({ rows: historial } = await query(
      `SELECT h.id, h.accion, h.fecha_baja, h.motivo, h.nota, h.created_at, u.nombre AS usuario
         FROM conversion_bajas_historial h LEFT JOIN users u ON u.id = h.user_id
        WHERE h.conversion_id = $1
        ORDER BY h.created_at DESC, h.id DESC`,
      [conversionId]
    ));
  } catch (err) {
    if (sinMigracion(err)) return { disponible: false, baja: null, historial: [], avisos: await avisosDe(conversionId) };
    throw err;
  }
  if (!venta) throw new AppError('Venta no encontrada', 404, 'CONVERSION_NOT_FOUND');
  return {
    disponible: true,
    baja: venta.baja_fecha ? conTexto({
      fecha: fechaISO(venta.baja_fecha),
      motivo: venta.baja_motivo,
      nota: venta.baja_nota || null,
      por: venta.baja_por_nombre || null,
      at: venta.baja_at,
    }) : null,
    historial: historial.map((h) => ({
      id: Number(h.id),
      accion: h.accion,
      fecha_baja: fechaISO(h.fecha_baja),
      motivo: h.motivo,
      motivo_texto: h.motivo ? textoMotivoBaja(h.motivo) : null,
      nota: h.nota || null,
      usuario: h.usuario || null,
      at: h.created_at,
    })),
    avisos: await avisosDe(conversionId),
  };
}

const fechaLegible = (iso) => {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
};

/** La nota en la ficha del cliente. El rastro no debe tumbar la baja. */
async function rastroEnLaFicha(leadId, texto, userId) {
  if (!leadId) return;
  try {
    await query(
      `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha) VALUES ($1, 'nota', $2, $3, NOW())`,
      [leadId, texto, userId || null]
    );
  } catch { /* el rastro no debe tumbar nada */ }
}

/**
 * Da de baja al alumno de esta venta, o cambia la baja que ya tiene.
 *   datos = { fecha: 'AAAA-MM-DD', motivo, nota }
 * La fecha no puede ser anterior a la de la venta.
 */
export async function darDeBaja(conversionId, { fecha, motivo, nota = null }, { userId = null } = {}) {
  const client = await getClient();
  let venta;
  let accion;
  try {
    await client.query('BEGIN');
    try {
      ({ rows: [venta] } = await client.query(
        `SELECT id, lead_id, fecha_conversion, producto_contratado, baja_fecha FROM conversions WHERE id = $1 FOR UPDATE`,
        [conversionId]
      ));
    } catch (err) { if (sinMigracion(err)) throw NO_DISPONIBLE(); throw err; }
    if (!venta) throw new AppError('Venta no encontrada', 404, 'CONVERSION_NOT_FOUND');
    const deLaVenta = fechaISO(venta.fecha_conversion);
    if (deLaVenta && fecha < deLaVenta) {
      throw new AppError(`La baja no puede ser anterior a la venta (${fechaLegible(deLaVenta)})`, 400, 'BAJA_ANTES_DE_LA_VENTA');
    }
    accion = venta.baja_fecha ? 'cambio' : 'baja';
    await client.query(
      `UPDATE conversions
          SET baja_fecha = $2, baja_motivo = $3, baja_nota = $4, baja_por = $5, baja_at = NOW(), updated_at = NOW()
        WHERE id = $1`,
      [conversionId, fecha, motivo, nota, userId]
    );
    await client.query(
      `INSERT INTO conversion_bajas_historial (conversion_id, accion, fecha_baja, motivo, nota, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [conversionId, accion, fecha, motivo, nota, userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ya cerrada */ }
    if (sinMigracion(err)) throw NO_DISPONIBLE();
    throw err;
  } finally {
    client.release();
  }

  await rastroEnLaFicha(
    venta.lead_id,
    `${accion === 'cambio' ? 'Baja cambiada' : 'Alumno dado de baja'} — ${venta.producto_contratado || `venta ${conversionId}`}: `
      + `${textoMotivoBaja(motivo)}, desde el ${fechaLegible(fecha)}${nota ? `. ${nota}` : ''}`,
    userId
  );
  return leerBaja(conversionId);
}

/** Deshace la baja: la venta vuelve a contar como antes. Queda en el historial. */
export async function deshacerBaja(conversionId, { userId = null, nota = null } = {}) {
  const client = await getClient();
  let venta;
  try {
    await client.query('BEGIN');
    try {
      ({ rows: [venta] } = await client.query(
        `SELECT id, lead_id, producto_contratado, baja_fecha, baja_motivo FROM conversions WHERE id = $1 FOR UPDATE`,
        [conversionId]
      ));
    } catch (err) { if (sinMigracion(err)) throw NO_DISPONIBLE(); throw err; }
    if (!venta) throw new AppError('Venta no encontrada', 404, 'CONVERSION_NOT_FOUND');
    if (!venta.baja_fecha) throw new AppError('Este alumno no está de baja', 404, 'SIN_BAJA');
    await client.query(
      `UPDATE conversions
          SET baja_fecha = NULL, baja_motivo = NULL, baja_nota = NULL, baja_por = NULL, baja_at = NULL, updated_at = NOW()
        WHERE id = $1`,
      [conversionId]
    );
    await client.query(
      `INSERT INTO conversion_bajas_historial (conversion_id, accion, fecha_baja, motivo, nota, user_id)
       VALUES ($1, 'deshecha', $2, $3, $4, $5)`,
      [conversionId, venta.baja_fecha, venta.baja_motivo, nota, userId]
    );
    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ya cerrada */ }
    if (sinMigracion(err)) throw NO_DISPONIBLE();
    throw err;
  } finally {
    client.release();
  }

  await rastroEnLaFicha(
    venta.lead_id,
    `Baja deshecha — ${venta.producto_contratado || `venta ${conversionId}`}: vuelve a contar como alumno${nota ? `. ${nota}` : ''}`,
    userId
  );
  return leerBaja(conversionId);
}
