import * as model from './connectors.model.js';
import * as adapters from './connectors.adapters.js';
import { TARGETS_CATALOG, TRANSFORMS_CATALOG } from './connectors.targets.js';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';

// Aplica field_mapping a un item. Cada entry del mapping puede ser:
//   - string ("path.dentro.del.json")
//   - objeto { source, transform, default, subfields? }
//
// Soporta:
//   - mapping plano: { nombre: 'name' } o { nombre: { source: 'name', transform: 'trim' } }
//   - mapping a custom_fields: { 'custom_fields.acf_field': 'acf.mi_campo' }
//   - mapping a array anidado (módulos): { _modules: { source: 'acf.modulos[*]', subfields: { titulo: 'titulo', horas: 'horas' } } }
function applyMapping(item, mapping) {
  const out = { custom_fields: {} };
  for (const [crmField, def] of Object.entries(mapping || {})) {
    const config = typeof def === 'string' ? { source: def } : (def || {});
    if (!config.source && config.default === undefined) continue;

    let value = config.source ? adapters.resolvePath(item, config.source) : undefined;
    if (config.transform) value = adapters.applyTransform(value, config.transform);
    if ((value === undefined || value === null || value === '') && config.default !== undefined) {
      value = config.default;
    }
    if (value === undefined || value === null) continue;

    // custom_fields.X → va a out.custom_fields[X]
    if (crmField.startsWith('custom_fields.')) {
      const fieldName = crmField.slice('custom_fields.'.length);
      out.custom_fields[fieldName] = value;
      continue;
    }

    // _modules → array de subitems con subfields mapeados
    if (crmField === '_modules' && Array.isArray(value)) {
      out._modules = value.map(sub => {
        const subItem = {};
        for (const [subKey, subPath] of Object.entries(config.subfields || {})) {
          const subConfig = typeof subPath === 'string' ? { source: subPath } : subPath;
          let subVal = subConfig.source ? adapters.resolvePath(sub, subConfig.source) : sub[subKey];
          if (subConfig.transform) subVal = adapters.applyTransform(subVal, subConfig.transform);
          if (subVal !== undefined && subVal !== null) subItem[subKey] = subVal;
        }
        return subItem;
      });
      continue;
    }

    out[crmField] = value;
  }
  if (Object.keys(out.custom_fields).length === 0) delete out.custom_fields;
  return out;
}

// Resuelve categoría por id numérico o por nombre (case-insensitive)
async function resolveCategoryId(projectId, value) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) return parseInt(value);
  const { rows } = await query(
    `SELECT id FROM product_categories WHERE project_id = $1 AND LOWER(nombre) = LOWER($2) LIMIT 1`,
    [projectId, String(value)]
  );
  return rows[0]?.id || null;
}

// Inserta o actualiza un producto en CRM con datos del conector
async function upsertProduct(projectId, mapped, originalItem) {
  if (!mapped.nombre) return { skipped: true };
  const sku = mapped.sku || null;
  const externalId = mapped.external_id || originalItem.id || null;
  let existing = null;
  if (sku) {
    const r = await query(`SELECT id FROM products WHERE project_id = $1 AND sku = $2 LIMIT 1`, [projectId, sku]);
    existing = r.rows[0];
  }
  if (!existing && externalId) {
    const r = await query(`SELECT id FROM products WHERE project_id = $1 AND wc_product_id = $2 LIMIT 1`, [projectId, externalId]);
    existing = r.rows[0];
  }

  const categoriaId = await resolveCategoryId(projectId, mapped.categoria_id);

  const fields = {
    nombre: mapped.nombre,
    descripcion: mapped.descripcion || null,
    precio: mapped.precio !== undefined ? parseFloat(mapped.precio) || null : null,
    // `|| null` no vale aqui: `products.moneda` es NOT NULL con DEFAULT 'EUR'.
    // Mandando null explicito, Postgres NO aplica el defecto y revienta — asi
    // que CUALQUIER importacion que no mapeara la moneda fallaba en todos sus
    // elementos, y el producto de WooCommerce no la trae. Se cae al defecto de
    // la columna, que es el que ya usa el resto del CRM.
    moneda: mapped.moneda || 'EUR',
    sku: sku,
    duracion: mapped.duracion || null,
    url_info: mapped.url_info || null,
    image_url: mapped.image_url || null,
    stripe_link: mapped.stripe_link || null,
    categoria_id: categoriaId,
    wc_product_id: externalId,
    wc_meta: JSON.stringify({ ...originalItem, _connector: true, _custom_fields: mapped.custom_fields || {} }),
  };

  if (existing) {
    await query(
      `UPDATE products SET nombre=$1, descripcion=$2, precio=$3, moneda=$4, sku=$5, duracion=$6,
       url_info=$7, image_url=COALESCE($8, image_url), stripe_link=$9, categoria_id=COALESCE($10, categoria_id),
       wc_meta=$11, updated_at=NOW() WHERE id=$12`,
      [fields.nombre, fields.descripcion, fields.precio, fields.moneda, fields.sku, fields.duracion,
       fields.url_info, fields.image_url, fields.stripe_link, fields.categoria_id, fields.wc_meta, existing.id]
    );
    return { action: 'updated', id: existing.id };
  }

  const ins = await query(
    `INSERT INTO products (project_id, nombre, descripcion, precio, moneda, sku, duracion, url_info, image_url, stripe_link, categoria_id, wc_product_id, wc_meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [projectId, fields.nombre, fields.descripcion, fields.precio, fields.moneda, fields.sku, fields.duracion,
     fields.url_info, fields.image_url, fields.stripe_link, fields.categoria_id, fields.wc_product_id, fields.wc_meta]
  );
  return { action: 'created', id: ins.rows[0].id };
}

// Inserta módulos del producto si el mapping incluye `_modules` (array)
async function upsertModules(productId, mappedModules) {
  if (!Array.isArray(mappedModules) || !mappedModules.length) return 0;
  await query(`DELETE FROM product_modules WHERE product_id = $1`, [productId]);
  for (let i = 0; i < mappedModules.length; i++) {
    const m = mappedModules[i];
    const titulo = m?.titulo || m?.title || m?.nombre || `Módulo ${i + 1}`;
    const descripcion = m?.descripcion || m?.description || m?.contenido || null;
    const horas = m?.horas || m?.hours || null;
    await query(
      `INSERT INTO product_modules (product_id, titulo, descripcion, horas, orden)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, titulo, descripcion, horas ? parseInt(horas) : null, i]
    );
  }
  return mappedModules.length;
}

/**
 * El campo «Campus» del mapeo: solo en los conectores de empresa o de todo el
 * sistema, que traen datos de varios campus. Lo que diga ahí —el nombre del
 * campus— decide adónde va cada elemento; lo que no lo diga, o diga uno que no
 * está en su alcance, va al campus por defecto (`project_id`).
 */
const CAMPO_CAMPUS = {
  key: 'campus', label: 'Campus (por su nombre; sin él, al campus por defecto)', type: 'string', group: 'Campus',
};
function targetsDe(c) {
  const base = TARGETS_CATALOG[c.destination] || TARGETS_CATALOG.product;
  return c.alcance && c.alcance !== 'campus' ? [...base, CAMPO_CAMPUS] : base;
}
const normal = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export async function previewConnector(connectorId) {
  const c = await model.findById(connectorId);
  if (!c) throw new AppError('Conector no encontrado', 404, 'NOT_FOUND');
  const { items, total } = await adapters.fetchSample(c);
  await model.saveSample(connectorId, items[0] || {});

  // Schema completo del item (todas las keys con tipos) para que el frontend
  // muestre tree-view y permita drag-to-map cualquier campo.
  const schema = items[0] ? adapters.inspectSchema(items[0]) : [];

  // Catálogo de campos destino del CRM según destination
  const targets = targetsDe(c);

  // Test de mapping: aplicar el field_mapping actual al primer sample
  let mapped_preview = null;
  try {
    if (c.field_mapping && Object.keys(c.field_mapping).length > 0 && items[0]) {
      mapped_preview = applyMapping(items[0], c.field_mapping);
    }
  } catch (e) { /* mapping inválido, ignorar */ }

  return {
    type: c.type,
    destination: c.destination,
    items_count_total: total,
    samples: items,
    schema,                         // [{ path, type, sample }]
    targets,                        // Campos destino disponibles
    transforms: TRANSFORMS_CATALOG, // Transformaciones disponibles
    field_mapping_actual: c.field_mapping,
    sugeridos: detectFieldsFromSample(items[0] || {}),
    mapped_preview,                 // resultado de aplicar mapping al primer item
  };
}

// Sugiere mapping inicial a partir de un item de muestra (heurística simple)
function detectFieldsFromSample(item) {
  if (!item || typeof item !== 'object') return {};
  const sug = {};
  for (const [k, v] of Object.entries(item)) {
    const key = k.toLowerCase();
    if (sug.nombre === undefined && (key === 'name' || key === 'title' || key === 'nombre')) sug.nombre = k;
    else if (sug.email === undefined && (key === 'email' || key.includes('mail'))) sug.email = k;
    else if (sug.telefono === undefined && (key === 'phone' || key === 'telefono' || key.includes('tel'))) sug.telefono = k;
    else if (sug.precio === undefined && (key === 'price' || key === 'precio' || key === 'amount')) sug.precio = k;
    else if (sug.sku === undefined && (key === 'sku' || key === 'code' || key === 'codigo')) sug.sku = k;
    else if (sug.descripcion === undefined && (key === 'description' || key === 'descripcion' || key === 'short_description')) sug.descripcion = k;
    else if (sug.url_info === undefined && (key === 'permalink' || key === 'url' || key === 'link')) sug.url_info = k;
  }
  return sug;
}

export async function importFromConnector(connectorId) {
  const c = await model.findById(connectorId);
  if (!c) throw new AppError('Conector no encontrado', 404, 'NOT_FOUND');
  if (!c.field_mapping || Object.keys(c.field_mapping).length === 0) {
    throw new AppError('Conector sin field_mapping configurado', 400, 'NO_MAPPING');
  }
  if (c.destination !== 'product') {
    throw new AppError(`Destination '${c.destination}' aún no soportada en import`, 501, 'NOT_IMPLEMENTED');
  }

  let created = 0, updated = 0, skipped = 0, errors = 0;
  try {
    const items = await adapters.fetchAll(c);
    logger.info({ connectorId, items: items.length }, 'Connector: items descargados');

    // Un conector de empresa o de todo el sistema es UNO para todos sus campus
    // (Diego, 29/09: «tiene que ser único»). Cada elemento va al campus que
    // diga su campo «Campus», siempre dentro del alcance; si no dice o no casa,
    // al campus por defecto. Nunca a un campus de fuera del alcance.
    const campus = c.alcance && c.alcance !== 'campus' ? await model.campusDelAlcance(c) : [];
    const porNombre = new Map(campus.map((p) => [normal(p.nombre), p.id]));
    const porId = new Set(campus.map((p) => Number(p.id)));
    const campusDe = (mapped) => {
      if (!campus.length || mapped.campus === undefined) return c.project_id;
      const dicho = mapped.campus;
      if (porNombre.has(normal(dicho))) return porNombre.get(normal(dicho));
      if (porId.has(Number(dicho))) return Number(dicho);
      return c.project_id;
    };

    for (const item of items) {
      try {
        const mapped = applyMapping(item, c.field_mapping);
        const destino = campusDe(mapped);
        delete mapped.campus;
        const result = await upsertProduct(destino, mapped, item);
        if (result.action === 'created') created++;
        else if (result.action === 'updated') updated++;
        else if (result.skipped) skipped++;
        // Si el mapping incluye campo `_modules` (path al array de módulos), insertarlos
        if (c.field_mapping._modules && result.id) {
          const modulesArray = adapters.resolvePath(item, c.field_mapping._modules);
          if (Array.isArray(modulesArray)) await upsertModules(result.id, modulesArray);
        }
      } catch (err) {
        errors++;
        logger.warn({ err: err.message, connectorId }, 'Connector: error en item');
      }
    }
    // Se guardan los que ENTRARON, no los que se miraron.
    //
    // Antes se guardaba `items.length`, o sea cuantos habia en el origen. La
    // pantalla lo enseña como «N traidos», asi que una importacion donde los
    // tres items fallaron —por ejemplo por un NOT NULL de `products.moneda`—
    // decia «3 traidos» con cero productos creados. Que es exactamente lo que
    // no puede hacer un contador.
    //
    // `partial` ya distingue que hubo fallos; el numero tiene que decir lo que
    // hay, no lo que se intento.
    await model.recordSync(connectorId, errors === 0 ? 'success' : 'partial', created + updated);
    return { total: items.length, created, updated, skipped, errors };
  } catch (err) {
    await model.recordSync(connectorId, 'error', 0);
    throw err;
  }
}
