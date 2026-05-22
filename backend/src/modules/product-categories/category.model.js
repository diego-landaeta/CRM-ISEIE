import { query } from '../../shared/config/db.js';

export async function listByProject(projectId) {
  const { rows } = await query(
    `SELECT c.*, p.nombre as parent_nombre
     FROM product_categories c
     LEFT JOIN product_categories p ON p.id = c.parent_id
     WHERE c.project_id = $1 AND c.active = true
     ORDER BY c.parent_id NULLS FIRST, c.orden, c.nombre`,
    [projectId]
  );
  return rows;
}

export async function create({ project_id, parent_id, nombre, orden = 0 }) {
  const { rows } = await query(
    `INSERT INTO product_categories (project_id, parent_id, nombre, orden)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [project_id, parent_id || null, nombre, orden]
  );
  return rows[0];
}

export async function update(id, data) {
  const allowed = ['nombre', 'parent_id', 'orden', 'active'];
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) {
    if (data[k] !== undefined) { sets.push(`${k} = $${idx++}`); params.push(data[k]); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(
    `UPDATE product_categories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

export async function remove(id) {
  await query(`UPDATE product_categories SET active = false WHERE id = $1`, [id]);
}

// Arbol jerarquico recursivo (cada nodo tiene children[])
export async function getTree(projectId) {
  const { rows } = await query(
    `SELECT id, parent_id, nombre, orden, source, external_url, external_id, active,
            (SELECT COUNT(*) FROM products p WHERE p.categoria_id = c.id) AS productos_count
     FROM product_categories c
     WHERE c.project_id = $1 AND c.active = true
     ORDER BY c.orden, c.nombre`,
    [projectId]
  );
  const byId = new Map();
  rows.forEach(r => byId.set(r.id, { ...r, productos_count: parseInt(r.productos_count), children: [] }));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
    else roots.push(node);
  }
  return roots;
}

// Cadena ancestral desde la raiz hasta la categoria dada
export async function getAncestors(categoryId) {
  const { rows } = await query(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, nombre, 0 AS depth FROM product_categories WHERE id = $1
       UNION ALL
       SELECT c.id, c.parent_id, c.nombre, chain.depth + 1
       FROM product_categories c
       JOIN chain ON chain.parent_id = c.id
     )
     SELECT id, parent_id, nombre FROM chain ORDER BY depth DESC`,
    [categoryId]
  );
  return rows;
}

// ¿parentCandidate es descendiente de categoryId? (validacion anti-ciclo)
export async function isDescendant(categoryId, parentCandidate) {
  if (!parentCandidate) return false;
  if (parseInt(categoryId) === parseInt(parentCandidate)) return true;
  const { rows } = await query(
    `WITH RECURSIVE d AS (
       SELECT id FROM product_categories WHERE id = $1
       UNION ALL
       SELECT c.id FROM product_categories c JOIN d ON c.parent_id = d.id
     )
     SELECT 1 FROM d WHERE id = $2 LIMIT 1`,
    [categoryId, parentCandidate]
  );
  return rows.length > 0;
}

// Upsert idempotente por (project_id, source, external_id) — usado por sync WC/WP
export async function upsertExternal({ project_id, parent_id, nombre, source, external_id, external_url, orden = 0 }) {
  if (external_id) {
    const { rows: ex } = await query(
      `SELECT id FROM product_categories WHERE project_id = $1 AND source = $2 AND external_id = $3`,
      [project_id, source, external_id]
    );
    if (ex[0]) {
      await query(
        `UPDATE product_categories
         SET nombre = $1, parent_id = $2, external_url = $3, orden = $4, active = true, updated_at = NOW()
         WHERE id = $5`,
        [nombre, parent_id || null, external_url || null, orden, ex[0].id]
      );
      return ex[0].id;
    }
  }
  const { rows } = await query(
    `INSERT INTO product_categories (project_id, parent_id, nombre, orden, source, external_id, external_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [project_id, parent_id || null, nombre, orden, source, external_id || null, external_url || null]
  );
  return rows[0].id;
}
