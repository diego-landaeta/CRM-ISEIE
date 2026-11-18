/*
  LO QUE AYUDA AL EQUIPO A ORGANIZARSE (#679).

    · Notas internas en una consulta: lo que una tutora deja escrito para quien la
      lleve después (un relevo, coordinación). Nunca sale al campus.
    · Respuestas guardadas en el servidor: las de cada tutora (la siguen a cualquier
      equipo) y las del campus (las define coordinación y las ven todas sus tutoras).
*/
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

const MAX_NOTA = 4000;
const MAX_TITULO = 120;
const MAX_TEXTO = 8000;

// ─── Notas internas ──────────────────────────────────────────────────────────

export async function notasDe(consultaId) {
  const { rows } = await query(
    `SELECT n.id, n.texto, n.created_at AS at, n.autor_user_id, u.nombre AS autor_nombre
       FROM consulta_notas n LEFT JOIN users u ON u.id = n.autor_user_id
      WHERE n.consulta_id = $1 ORDER BY n.created_at, n.id`, [consultaId]);
  return rows;
}

export async function anotar(consulta, userId, texto) {
  const t = String(texto || '').trim();
  if (!t) throw new AppError('Escribe la nota', 400, 'VALIDATION_ERROR');
  if (t.length > MAX_NOTA) throw new AppError(`La nota no puede pasar de ${MAX_NOTA} caracteres`, 400, 'VALIDATION_ERROR');
  await query(
    'INSERT INTO consulta_notas (consulta_id, project_id, autor_user_id, texto) VALUES ($1, $2, $3, $4)',
    [consulta.id, consulta.project_id, userId, t]);
  return notasDe(consulta.id);
}

// ─── Respuestas guardadas ────────────────────────────────────────────────────

const limpia = ({ titulo, texto }) => {
  const ti = String(titulo || '').trim();
  const te = String(texto || '').trim();
  if (!ti || !te) throw new AppError('Pon un título y el texto', 400, 'VALIDATION_ERROR');
  if (ti.length > MAX_TITULO) throw new AppError(`El título no puede pasar de ${MAX_TITULO} caracteres`, 400, 'VALIDATION_ERROR');
  if (te.length > MAX_TEXTO) throw new AppError(`El texto no puede pasar de ${MAX_TEXTO} caracteres`, 400, 'VALIDATION_ERROR');
  return { titulo: ti, texto: te };
};

/** Las suyas y las de sus campus (`campus`: ids de proyecto, o null = todos). */
export async function respuestasDe(userId, campus) {
  const { rows } = await query(
    `SELECT r.id, r.titulo, r.texto, r.project_id, p.nombre AS campus, (r.user_id IS NOT NULL) AS personal, r.updated_at
       FROM respuestas_guardadas r LEFT JOIN projects p ON p.id = r.project_id
      WHERE r.user_id = $1 OR (r.project_id IS NOT NULL AND ($2::int[] IS NULL OR r.project_id = ANY($2::int[])))
      ORDER BY (r.user_id IS NOT NULL) DESC, lower(r.titulo)`, [userId, campus]);
  return rows;
}

/** Personal (sin `projectId`) o del campus (con `projectId`: lo decide quien llama). */
export async function crearRespuesta(userId, datos, projectId = null) {
  const { titulo, texto } = limpia(datos);
  const { rows } = await query(
    `INSERT INTO respuestas_guardadas (user_id, project_id, titulo, texto, creado_por)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [projectId ? null : userId, projectId || null, titulo, texto, userId]);
  return rows[0].id;
}

export async function respuesta(id) {
  const { rows } = await query('SELECT id, user_id, project_id FROM respuestas_guardadas WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function cambiarRespuesta(id, datos) {
  const { titulo, texto } = limpia(datos);
  await query('UPDATE respuestas_guardadas SET titulo = $2, texto = $3, updated_at = NOW() WHERE id = $1', [id, titulo, texto]);
}

export async function borrarRespuesta(id) {
  await query('DELETE FROM respuestas_guardadas WHERE id = $1', [id]);
}

/**
 * Las que la tutora tenía en su navegador (antes de esto) pasan a su cuenta, sin
 * duplicar por título. Devuelve cuántas se han añadido.
 */
export async function importarDelNavegador(userId, lista) {
  let n = 0;
  for (const r of (Array.isArray(lista) ? lista : []).slice(0, 100)) {
    let datos;
    try { datos = limpia(r); } catch { continue; }
    const { rowCount } = await query(
      `INSERT INTO respuestas_guardadas (user_id, titulo, texto, creado_por)
       SELECT $1::int, $2::varchar, $3::text, $1::int
        WHERE NOT EXISTS (SELECT 1 FROM respuestas_guardadas WHERE user_id = $1::int AND lower(titulo) = lower($2::varchar))`,
      [userId, datos.titulo, datos.texto]);
    n += rowCount;
  }
  return n;
}
