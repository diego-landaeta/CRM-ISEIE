import { query } from '../../shared/config/db.js';

// Los pasos del proceso comercial (#87).
//
// Se leen y se escriben SIEMPRE dentro de un proyecto: cada uno puede llevar su
// propio proceso, y mezclarlos seria dar a una gestora la cola de otra marca.

const COLS = `id, project_id, clave, nombre, orden, cuando,
              dia_desde, dia_hasta, canales, es_seguimiento, nota, activo,
              created_at, updated_at`;

export async function listByProject(projectId, { includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLS} FROM commercial_steps
      WHERE project_id = $1 ${includeInactive ? '' : 'AND activo = true'}
      ORDER BY orden, id`,
    [projectId]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(`SELECT ${COLS} FROM commercial_steps WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function findByClave(projectId, clave) {
  const { rows } = await query(
    `SELECT ${COLS} FROM commercial_steps WHERE project_id = $1 AND clave = $2`,
    [projectId, clave]
  );
  return rows[0] || null;
}

export async function create(projectId, data) {
  // Al final de la lista salvo que digan otra cosa: un paso nuevo que aparece
  // en medio descoloca la cola de todo el mundo sin avisar.
  const { rows } = await query(
    `INSERT INTO commercial_steps
       (project_id, clave, nombre, orden, cuando, dia_desde, dia_hasta,
        canales, es_seguimiento, nota)
     VALUES ($1, $2, $3,
             COALESCE($4, (SELECT COALESCE(MAX(orden), 0) + 1 FROM commercial_steps WHERE project_id = $1)),
             $5, $6, $7, COALESCE($8, '{}'), COALESCE($9, false), $10)
     RETURNING ${COLS}`,
    [projectId, data.clave, data.nombre, data.orden ?? null, data.cuando ?? null,
     data.dia_desde ?? null, data.dia_hasta ?? null, data.canales ?? null,
     data.es_seguimiento ?? null, data.nota ?? null]
  );
  return rows[0];
}

export async function update(id, data) {
  // `clave` NO esta en la lista a proposito: es por donde entra el codigo, y
  // dejar que se renombre desde la pantalla es exactamente como se rompe.
  const permitidos = ['nombre', 'orden', 'cuando', 'dia_desde', 'dia_hasta',
                      'canales', 'es_seguimiento', 'nota', 'activo'];
  const campos = [];
  const valores = [];
  let i = 1;
  for (const k of permitidos) {
    if (data[k] !== undefined) { campos.push(`${k} = $${i++}`); valores.push(data[k]); }
  }
  if (campos.length === 0) return findById(id);
  campos.push('updated_at = NOW()');
  valores.push(id);
  const { rows } = await query(
    `UPDATE commercial_steps SET ${campos.join(', ')} WHERE id = $${i} RETURNING ${COLS}`,
    valores
  );
  return rows[0];
}

// Reordenar de una vez y en una transaccion: si se hiciera paso a paso y algo
// fallara por medio, la lista quedaria a medio ordenar y nadie lo sabria.
export async function reorder(projectId, idsEnOrden) {
  const { rows } = await query(
    `UPDATE commercial_steps s
        SET orden = nuevo.pos, updated_at = NOW()
       FROM (SELECT id::int, ordinality::int AS pos
               FROM unnest($2::int[]) WITH ORDINALITY AS t(id, ordinality)) AS nuevo
      WHERE s.id = nuevo.id AND s.project_id = $1
      RETURNING s.id`,
    [projectId, idsEnOrden]
  );
  return rows.length;
}

// Se desactiva, no se borra. Un paso borrado se lleva por delante la lectura de
// lo que ya paso: las interacciones viejas apuntaban a el.
export async function deactivate(id) {
  const { rows } = await query(
    `UPDATE commercial_steps SET activo = false, updated_at = NOW()
      WHERE id = $1 RETURNING ${COLS}`,
    [id]
  );
  return rows[0];
}
