import { getClient, query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * El baremo de la tasa de cierre (#39): qué significa «un 8,2 %».
 *
 * Los tramos los pone quien lleva el negocio, desde la pantalla, y viven en la
 * base (`tasa_cierre_baremo`, migración 219). Aquí no hay umbrales escritos: si
 * no hay baremo, no se etiqueta a nadie —que un número esté «en rojo» sin que
 * nadie haya dicho cuánto es poco, hace que media plantilla salga mal para nada—
 * y la pantalla compara a cada gestora con el equipo.
 *
 *   · un tramo vale desde su `desde_pct` hasta el siguiente;
 *   · siempre hay uno que empieza en 0 (ninguna tasa queda sin etiqueta);
 *   · un campus puede tener el suyo, que manda sobre el general (`project_id` NULL).
 */

export const TONOS = ['flojo', 'normal', 'bueno'];
export const MAX_TRAMOS = 6;

/** El baremo que aplica a unos campus: el propio si es UNO solo y lo tiene; si no, el general. */
export async function tramosPara(projectIds) {
  const unico = Array.isArray(projectIds) && projectIds.length === 1 ? Number(projectIds[0]) : null;
  if (unico) {
    const { rows } = await query(
      `SELECT desde_pct::float AS desde_pct, etiqueta, tono FROM tasa_cierre_baremo WHERE project_id = $1 ORDER BY desde_pct`, [unico]);
    if (rows.length) return { ambito: 'campus', project_id: unico, tramos: rows };
  }
  const { rows } = await query(
    `SELECT desde_pct::float AS desde_pct, etiqueta, tono FROM tasa_cierre_baremo WHERE project_id IS NULL ORDER BY desde_pct`);
  return { ambito: rows.length ? 'general' : 'ninguno', project_id: null, tramos: rows };
}

/** El tramo en el que cae una tasa: el último cuyo `desde_pct` no la supera. null sin baremo. */
export function lecturaDe(tasa, tramos) {
  if (!tramos?.length || tasa == null) return null;
  let elegido = null;
  for (const t of tramos) if (Number(tasa) >= Number(t.desde_pct)) elegido = t;
  return elegido ? { etiqueta: elegido.etiqueta, tono: elegido.tono, desde_pct: Number(elegido.desde_pct) } : null;
}

/** Valida los tramos que llegan de la pantalla. Lanza AppError 400 con lo que está mal. */
export function validarTramos(tramos) {
  if (!Array.isArray(tramos) || tramos.length < 1) throw new AppError('Hace falta al menos un tramo', 400, 'VALIDATION_ERROR');
  if (tramos.length > MAX_TRAMOS) throw new AppError(`Como mucho ${MAX_TRAMOS} tramos`, 400, 'VALIDATION_ERROR');
  const limpios = tramos.map((t) => ({
    desde_pct: Number(t?.desde_pct),
    etiqueta: String(t?.etiqueta ?? '').trim(),
    tono: t?.tono,
  }));
  for (const t of limpios) {
    if (!Number.isFinite(t.desde_pct) || t.desde_pct < 0 || t.desde_pct >= 100) throw new AppError('Cada tramo empieza en un porcentaje entre 0 y 100', 400, 'VALIDATION_ERROR');
    if (!t.etiqueta || t.etiqueta.length > 30) throw new AppError('Cada tramo lleva una etiqueta de hasta 30 caracteres', 400, 'VALIDATION_ERROR');
    if (!TONOS.includes(t.tono)) throw new AppError(`El tono de un tramo es ${TONOS.join(', ')}`, 400, 'VALIDATION_ERROR');
    t.desde_pct = Math.round(t.desde_pct * 100) / 100;
  }
  limpios.sort((a, b) => a.desde_pct - b.desde_pct);
  if (limpios[0].desde_pct !== 0) throw new AppError('El primer tramo tiene que empezar en 0 %, para que ninguna tasa se quede sin etiqueta', 400, 'VALIDATION_ERROR');
  for (let i = 1; i < limpios.length; i += 1) {
    if (limpios[i].desde_pct === limpios[i - 1].desde_pct) throw new AppError('Dos tramos no pueden empezar en el mismo porcentaje', 400, 'VALIDATION_ERROR');
  }
  return limpios;
}

/** Sustituye el baremo de un ámbito (`projectId` null = el general) por estos tramos, de una vez. */
export async function guardarTramos({ projectId = null, tramos, userId = null }) {
  const limpios = validarTramos(tramos);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM tasa_cierre_baremo WHERE COALESCE(project_id, 0) = COALESCE($1::int, 0)`, [projectId]);
    for (const t of limpios) {
      await client.query(
        `INSERT INTO tasa_cierre_baremo (project_id, desde_pct, etiqueta, tono, updated_by) VALUES ($1, $2, $3, $4, $5)`,
        [projectId, t.desde_pct, t.etiqueta, t.tono, userId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  return limpios;
}

/** Quita el baremo de un ámbito: vuelve a no etiquetar y a comparar con el equipo. */
export async function quitarTramos(projectId = null) {
  await query(`DELETE FROM tasa_cierre_baremo WHERE COALESCE(project_id, 0) = COALESCE($1::int, 0)`, [projectId]);
}
