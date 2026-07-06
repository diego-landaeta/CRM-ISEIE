import { query } from '../../shared/config/db.js';

// Mapping default basado en Fono (scraper-based) - funciona out-of-the-box
// para cualquier WP-Elementor educativo sin tocar ACF. Se aplica automaticamente
// al crear las credenciales de un proyecto nuevo si no se especifica otro mapping.
// El admin puede sobreescribirlo desde el UI cuando quiera.
export const DEFAULT_FIELD_MAPPING = {
  sku: 'sku',
  nombre: 'name',
  precio: 'price',
  descripcion: 'short_description',
  url_info: 'scraper.url_used',
  image_url: 'scraper.imagen_og',
  horas: 'scraper.meta_box.horas.text',
  duracion: 'scraper.meta_box.duracion.text',
  modalidad: 'scraper.meta_box.modalidad.text',
  num_modulos: 'scraper.meta_box.num_modulos.text',
  modulos_texto: 'scraper.sections.modulos',
  objetivos_texto: 'scraper.sections.objetivos',
  beneficios_texto: 'scraper.sections.beneficios',
  dirigido_a_texto: 'scraper.sections.dirigido_a',
  metodologia_texto: 'scraper.sections.metodologia',
  presentacion_texto: 'scraper.sections.presentacion',
  por_que_estudiar_texto: 'scraper.sections.por_que_estudiar',
  para_que_te_prepara_texto: 'scraper.sections.para_que_te_prepara',
  faqs_texto: 'scraper.sections.faqs',
};

export async function getCreds(projectId) {
  const { rows } = await query(`SELECT * FROM wc_credentials WHERE project_id = $1`, [projectId]);
  return rows[0] || null;
}
export async function upsertCreds(projectId, data) {
  const { rows } = await query(
    `INSERT INTO wc_credentials (
        project_id, store_url, consumer_key, consumer_secret,
        active, auto_sync_enabled, sync_interval_minutes, default_currency,
        wp_user, wp_app_password,
        source_strategy, cpt_endpoints,
        scraper_enabled, scrape_strategy, section_keywords,
        field_mapping
     )
     VALUES (
        $1, $2, $3, $4,
        COALESCE($5, true), COALESCE($6, false), COALESCE($7, 30), COALESCE($8, 'EUR'),
        $9, $10,
        COALESCE($11, 'wc_only'), COALESCE($12, '[]'::jsonb),
        COALESCE($13, false), COALESCE($14, 'plain_text'), $15,
        $16::jsonb
     )
     ON CONFLICT (project_id) DO UPDATE
       SET store_url = EXCLUDED.store_url,
           consumer_key = EXCLUDED.consumer_key,
           consumer_secret = CASE WHEN EXCLUDED.consumer_secret = '' THEN wc_credentials.consumer_secret ELSE EXCLUDED.consumer_secret END,
           active = EXCLUDED.active,
           auto_sync_enabled = EXCLUDED.auto_sync_enabled,
           sync_interval_minutes = EXCLUDED.sync_interval_minutes,
           default_currency = EXCLUDED.default_currency,
           wp_user = EXCLUDED.wp_user,
           wp_app_password = CASE WHEN EXCLUDED.wp_app_password = '' OR EXCLUDED.wp_app_password IS NULL
                                  THEN wc_credentials.wp_app_password ELSE EXCLUDED.wp_app_password END,
           source_strategy = EXCLUDED.source_strategy,
           cpt_endpoints = EXCLUDED.cpt_endpoints,
           scraper_enabled = EXCLUDED.scraper_enabled,
           scrape_strategy = EXCLUDED.scrape_strategy,
           section_keywords = COALESCE(EXCLUDED.section_keywords, wc_credentials.section_keywords),
           field_mapping = CASE
             WHEN wc_credentials.field_mapping IS NULL OR wc_credentials.field_mapping = '{}'::jsonb
               THEN EXCLUDED.field_mapping
             ELSE wc_credentials.field_mapping
           END,
           updated_at = NOW()
     RETURNING *`,
    [
      projectId,
      data.store_url, data.consumer_key, data.consumer_secret || '',
      data.active, data.auto_sync_enabled, data.sync_interval_minutes, data.default_currency,
      data.wp_user || null, data.wp_app_password || null,
      data.source_strategy, JSON.stringify(data.cpt_endpoints || []),
      data.scraper_enabled, data.scrape_strategy,
      data.section_keywords ? JSON.stringify(data.section_keywords) : null,
      JSON.stringify(DEFAULT_FIELD_MAPPING),
    ]
  );
  return rows[0];
}
export async function deleteCreds(projectId) { await query(`DELETE FROM wc_credentials WHERE project_id = $1`, [projectId]); }

export async function listMappings(projectId) {
  const { rows } = await query(`SELECT * FROM wc_field_mappings WHERE project_id = $1 ORDER BY id`, [projectId]);
  return rows;
}
export async function setMappings(projectId, mappings) {
  await query(`DELETE FROM wc_field_mappings WHERE project_id = $1`, [projectId]);
  for (const m of mappings) {
    await query(`INSERT INTO wc_field_mappings (project_id, wc_field, crm_field, is_meta) VALUES ($1, $2, $3, $4)`, [projectId, m.wc_field, m.crm_field, !!m.is_meta]);
  }
  return listMappings(projectId);
}

export async function listRuns(projectId) {
  const { rows } = await query(`SELECT * FROM wc_import_runs WHERE project_id = $1 ORDER BY started_at DESC LIMIT 50`, [projectId]);
  return rows;
}

// Run mas reciente (en curso si hay uno corriendo, o el ultimo finalizado)
export async function getCurrentRun(projectId) {
  const { rows } = await query(
    `SELECT id, status, total_fetched, total_created, total_updated, total_skipped,
            error_message, started_at, finished_at,
            EXTRACT(EPOCH FROM (COALESCE(finished_at, NOW()) - started_at))::int AS elapsed_seconds
     FROM wc_import_runs WHERE project_id = $1
     ORDER BY started_at DESC LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}
export async function startRun(projectId, userId) {
  const { rows } = await query(`INSERT INTO wc_import_runs (project_id, triggered_by) VALUES ($1, $2) RETURNING *`, [projectId, userId]);
  return rows[0];
}
// Actualiza contadores mid-run para mostrar progreso en vivo sin marcar finished_at.
export async function updateRunProgress(id, fields) {
  const sets = [];
  const vals = [id];
  const add = (col, v) => { if (v !== undefined) { sets.push(`${col}=$${vals.length + 1}`); vals.push(v); } };
  add('total_fetched', fields.total_fetched);
  add('total_created', fields.total_created);
  add('total_updated', fields.total_updated);
  add('total_skipped', fields.total_skipped);
  if (sets.length === 0) return;
  await query(`UPDATE wc_import_runs SET ${sets.join(', ')} WHERE id=$1`, vals);
}

export async function finishRun(id, fields) {
  const { rows } = await query(
    `UPDATE wc_import_runs SET status=$2, total_fetched=$3, total_created=$4, total_updated=$5, total_skipped=$6, error_message=$7, finished_at=NOW() WHERE id=$1 RETURNING *`,
    [id, fields.status, fields.total_fetched || 0, fields.total_created || 0, fields.total_updated || 0, fields.total_skipped || 0, fields.error_message || null]);
  return rows[0];
}

export async function findProductByWcId(projectId, wcId) {
  const { rows } = await query(`SELECT id FROM products WHERE project_id = $1 AND wc_product_id = $2`, [projectId, wcId]);
  return rows[0] || null;
}
// Busca un producto del proyecto por nombre exacto (case-insensitive trim).
// Usado como fallback en el upsert: si los datos vienen del CPT y el nombre
// ya existe (importado antes por WC), reusamos ese producto para no chocar
// con la UNIQUE constraint (project_id, nombre).
async function findProductByExactName(projectId, nombre) {
  if (!nombre) return null;
  const { rows } = await query(
    `SELECT id, wc_product_id FROM products
     WHERE project_id = $1 AND LOWER(TRIM(nombre)) = LOWER(TRIM($2))
     LIMIT 1`,
    [projectId, nombre]
  );
  return rows[0] || null;
}

// Sanitiza precio: si viene como string "1,950 €" o "1.950,00", lo convierte a numero.
// Casos: number → pasa; numeric string → parseFloat; europeo con miles → parsePriceNumber.
function sanitizePrecio(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  // Si es numero puro JS valido
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  // Sino, extraer y parsear con logica europea (coma=miles si 3 dig despues)
  const m = s.match(/[\d.,]+/);
  if (!m) return null;
  const numStr = m[0];
  const hasDot = numStr.includes('.');
  const hasComma = numStr.includes(',');
  if (hasDot && hasComma) {
    const lastDot = numStr.lastIndexOf('.');
    const lastComma = numStr.lastIndexOf(',');
    return parseFloat(lastDot > lastComma ? numStr.replace(/,/g, '') : numStr.replace(/\./g, '').replace(',', '.'));
  }
  if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const parts = numStr.split(sep);
    if (parts.length === 2 && parts[1].length === 3) return parseFloat(numStr.replace(sep, ''));
    if (parts.length > 2) return parseFloat(numStr.split(sep).join(''));
    return parseFloat(numStr.replace(',', '.'));
  }
  return parseFloat(numStr);
}

export async function upsertProductFromWc({ projectId, wcId, data }) {
  // 1) Por wc_product_id. 2) Fallback por nombre exacto (caso CPT que choca con WC).
  let existing = await findProductByWcId(projectId, wcId);
  if (!existing) {
    const byName = await findProductByExactName(projectId, data.nombre);
    if (byName) existing = byName;
  }
  // Sanitizar precio defensivamente — el mapping del user puede apuntar a
  // scraper.meta_box.precio.text en vez de .value (texto vs numero).
  data.precio = sanitizePrecio(data.precio);
  const meta = data.meta || {};
  // Campos de scraping (todos opcionales). Si vienen, se guardan; si no, queda NULL.
  const sc = {
    duracion:           data.duracion ?? null,
    horas:              data.horas ?? null,
    fecha_inicio_texto: data.fecha_inicio_texto ?? null,
    num_modulos:        Number.isFinite(data.num_modulos) ? data.num_modulos : null,
    modalidad:          data.modalidad ?? null,
    image_url:          data.image_url ?? null,
    url_info:           data.url_info ?? null,
    stripe_link:        data.stripe_link ?? null,
    brochure_url:       data.brochure_url ?? null,
    presentacion_texto:       data.presentacion_texto ?? null,
    objetivos_texto:          data.objetivos_texto ?? null,
    beneficios_texto:         data.beneficios_texto ?? null,
    dirigido_a_texto:         data.dirigido_a_texto ?? null,
    para_que_te_prepara_texto: data.para_que_te_prepara_texto ?? null,
    por_que_estudiar_texto:   data.por_que_estudiar_texto ?? null,
    modulos_texto:            data.modulos_texto ?? null,
    metodologia_texto:        data.metodologia_texto ?? null,
    faqs_texto:               data.faqs_texto ?? null,
    profesores_texto:         data.profesores_texto ?? null,
    otras_secciones:          data.otras_secciones ? JSON.stringify(data.otras_secciones) : null,
  };

  if (existing) {
    const { rows } = await query(
      `UPDATE products
       SET nombre=$1,
           -- Precio "pegajoso": si la fuente no trae precio (0/null) NO pisamos el
           -- que ya haya (puesto a mano o de un scrape anterior). Sostenible:
           -- pones el precio del Máster una vez y el sync no lo borra nunca.
           precio = COALESCE(NULLIF($2, 0), precio),
           descripcion=$3, sku=$4,
           categoria_id=$5, subcategoria_id=$6, wc_meta=$7,
           duracion = COALESCE($9, duracion),
           horas = COALESCE($10, horas),
           fecha_inicio_texto = COALESCE($11, fecha_inicio_texto),
           num_modulos = COALESCE($12, num_modulos),
           modalidad = COALESCE($13, modalidad),
           image_url = COALESCE($14, image_url),
           url_info = COALESCE($15, url_info),
           presentacion_texto       = COALESCE($16, presentacion_texto),
           objetivos_texto          = COALESCE($17, objetivos_texto),
           beneficios_texto         = COALESCE($18, beneficios_texto),
           dirigido_a_texto         = COALESCE($19, dirigido_a_texto),
           para_que_te_prepara_texto = COALESCE($20, para_que_te_prepara_texto),
           por_que_estudiar_texto   = COALESCE($21, por_que_estudiar_texto),
           modulos_texto            = COALESCE($22, modulos_texto),
           metodologia_texto        = COALESCE($23, metodologia_texto),
           faqs_texto               = COALESCE($24, faqs_texto),
           profesores_texto         = COALESCE($25, profesores_texto),
           otras_secciones          = COALESCE($26::jsonb, otras_secciones),
           stripe_link              = COALESCE($27, stripe_link),
           brochure_url             = COALESCE($28, brochure_url),
           updated_at=NOW()
       WHERE id = $8 RETURNING id`,
      [data.nombre, data.precio, data.descripcion || null, data.sku || null,
       data.categoria_id || null, data.subcategoria_id || null,
       JSON.stringify(meta), existing.id,
       sc.duracion, sc.horas, sc.fecha_inicio_texto, sc.num_modulos, sc.modalidad,
       sc.image_url, sc.url_info,
       sc.presentacion_texto, sc.objetivos_texto, sc.beneficios_texto, sc.dirigido_a_texto,
       sc.para_que_te_prepara_texto, sc.por_que_estudiar_texto, sc.modulos_texto,
       sc.metodologia_texto, sc.faqs_texto, sc.profesores_texto, sc.otras_secciones,
       sc.stripe_link, sc.brochure_url]);
    return { action: 'updated', id: rows[0].id };
  }
  const { rows } = await query(
    `INSERT INTO products (project_id, nombre, precio, descripcion, sku,
                           categoria_id, subcategoria_id, wc_product_id, wc_meta,
                           duracion, horas, fecha_inicio_texto, num_modulos, modalidad,
                           image_url, url_info,
                           presentacion_texto, objetivos_texto, beneficios_texto,
                           dirigido_a_texto, para_que_te_prepara_texto, por_que_estudiar_texto,
                           modulos_texto, metodologia_texto, faqs_texto, profesores_texto,
                           otras_secciones, stripe_link, brochure_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, $28, $29)
     RETURNING id`,
    [projectId, data.nombre, data.precio, data.descripcion || null, data.sku || null,
     data.categoria_id || null, data.subcategoria_id || null,
     wcId, JSON.stringify(meta),
     sc.duracion, sc.horas, sc.fecha_inicio_texto, sc.num_modulos, sc.modalidad,
     sc.image_url, sc.url_info,
     sc.presentacion_texto, sc.objetivos_texto, sc.beneficios_texto, sc.dirigido_a_texto,
     sc.para_que_te_prepara_texto, sc.por_que_estudiar_texto, sc.modulos_texto,
     sc.metodologia_texto, sc.faqs_texto, sc.profesores_texto, sc.otras_secciones,
     sc.stripe_link, sc.brochure_url]);
  return { action: 'created', id: rows[0].id };
}

// Upsert categoria WC -> product_categories. Devuelve id local.
export async function upsertCategoryByWcId(projectId, wcCategoryId, nombre, parentLocalId) {
  // Buscar primero por external_id+source (idempotente entre re-syncs)
  const externalId = String(wcCategoryId);
  const ex = await query(
    `SELECT id FROM product_categories
     WHERE project_id = $1 AND source = 'wc' AND external_id = $2 LIMIT 1`,
    [projectId, externalId]
  );
  if (ex.rows[0]) {
    await query(
      `UPDATE product_categories SET nombre = $1, parent_id = $2, active = true, updated_at = NOW() WHERE id = $3`,
      [nombre, parentLocalId || null, ex.rows[0].id]
    );
    return ex.rows[0].id;
  }

  // Fallback: por nombre+parent (compat con categorias legacy sin external_id)
  const byName = await query(
    `SELECT id FROM product_categories
     WHERE project_id = $1 AND nombre = $2 AND parent_id IS NOT DISTINCT FROM $3 LIMIT 1`,
    [projectId, nombre, parentLocalId]
  );
  if (byName.rows[0]) {
    await query(
      `UPDATE product_categories SET source = 'wc', external_id = $1, updated_at = NOW() WHERE id = $2`,
      [externalId, byName.rows[0].id]
    );
    return byName.rows[0].id;
  }

  const { rows } = await query(
    `INSERT INTO product_categories (project_id, nombre, parent_id, source, external_id)
     VALUES ($1, $2, $3, 'wc', $4) RETURNING id`,
    [projectId, nombre, parentLocalId || null, externalId]
  );
  return rows[0].id;
}
