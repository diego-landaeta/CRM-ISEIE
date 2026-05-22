import { query, getClient } from '../../shared/config/db.js';

export async function findByProduct(productId) {
  const { rows } = await query(
    `SELECT d.*, u.nombre AS subido_por_nombre
     FROM dossiers d
     LEFT JOIN users u ON u.id = d.subido_por
     WHERE d.product_id = $1
     ORDER BY d.version DESC`,
    [productId]
  );
  return rows;
}

export async function findActiveByProduct(productId) {
  const { rows } = await query(
    `SELECT d.*, u.nombre AS subido_por_nombre
     FROM dossiers d
     LEFT JOIN users u ON u.id = d.subido_por
     WHERE d.product_id = $1 AND d.active = true
     ORDER BY d.version DESC
     LIMIT 1`,
    [productId]
  );
  return rows[0] || null;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT d.*, u.nombre AS subido_por_nombre
     FROM dossiers d
     LEFT JOIN users u ON u.id = d.subido_por
     WHERE d.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function createNewVersion({ productId, s3Key, filenameOriginal, sizeBytes, subidoPor }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE dossiers SET active = false WHERE product_id = $1 AND active = true`,
      [productId]
    );

    const { rows: [{ max_version }] } = await client.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM dossiers WHERE product_id = $1`,
      [productId]
    );

    const newVersion = max_version + 1;

    const { rows } = await client.query(
      `INSERT INTO dossiers (product_id, s3_key, filename_original, size_bytes, version, active, subido_por)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING *`,
      [productId, s3Key, filenameOriginal, sizeBytes, newVersion, subidoPor]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
