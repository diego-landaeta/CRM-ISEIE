import * as ProductService from './product.service.js';
import { createProductSchema, updateProductSchema } from './product.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';

export async function list(req, res, next) {
  try {
    const categoryId = req.query.categoryId ? parseInt(req.query.categoryId) : null;
    const includeInactive = req.query.includeInactive === 'true';
    const products = await ProductService.listByProject(req.projectId, { categoryId, includeInactive });
    // Resolver presigned URLs en paralelo solo para los que tienen image_url.
    const enriched = await Promise.all(products.map(async (p) => {
      if (!p.image_url) return p;
      try {
        const signed = await ProductService.resolveImageUrl(p.image_url);
        return { ...p, image_url_signed: signed };
      } catch {
        return p;
      }
    }));
    res.json({ success: true, data: enriched });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const product = await ProductService.getById(Number(req.params.id), req.projectId);
    if (product.image_url) {
      try {
        product.image_url_signed = await ProductService.resolveImageUrl(product.image_url);
      } catch { /* best-effort */ }
    }
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createProductSchema.parse({ ...req.body, projectId: req.projectId });
    const product = await ProductService.create(parsed);
    res.status(201).json({ success: true, data: product });
  } catch (err) {
    if (err.name === 'ZodError') {
      return next(new AppError(err.errors.map(e => e.message).join(', '), 400, 'VALIDATION_ERROR'));
    }
    next(err);
  }
}

export async function update(req, res, next) {
  try {
    const parsed = updateProductSchema.parse(req.body);
    const product = await ProductService.update(Number(req.params.id), req.projectId, parsed);
    res.json({ success: true, data: product });
  } catch (err) {
    if (err.name === 'ZodError') {
      return next(new AppError(err.errors.map(e => e.message).join(', '), 400, 'VALIDATION_ERROR'));
    }
    next(err);
  }
}

export async function deactivate(req, res, next) {
  try {
    const product = await ProductService.deactivate(Number(req.params.id), req.projectId);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function uploadImage(req, res, next) {
  try {
    const product = await ProductService.uploadImage(Number(req.params.id), req.projectId, req.file);
    const url = await ProductService.resolveImageUrl(product.image_url);
    res.status(201).json({ success: true, data: { ...product, image_url_signed: url } });
  } catch (err) { next(err); }
}

export async function removeImage(req, res, next) {
  try {
    const product = await ProductService.removeImage(Number(req.params.id), req.projectId);
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function getImageUrl(req, res, next) {
  try {
    const product = await ProductService.getById(Number(req.params.id), req.projectId);
    if (!product.image_url) return res.json({ success: true, data: { url: null } });
    const url = await ProductService.resolveImageUrl(product.image_url);
    res.json({ success: true, data: { url } });
  } catch (err) { next(err); }
}

// GET /api/products/export?projectId=X&format=csv|json
// Devuelve TODOS los productos del proyecto con todos los campos importados.
function _csvEscape(v) {
  if (v == null) return '';
  const s = String(v).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return /[,";]/.test(s) || s.length > 100 ? `"${s}"` : s;
}

export async function exportAll(req, res, next) {
  try {
    const projectId = req.projectId;
    const format = (req.query.format || 'json').toLowerCase();
    // NOTA CRM-ISEIE: el JOIN a product_categories queda inhabilitado hasta
    // que se porte ese modulo. Devolvemos NULL para categoria_nombre.
    const { rows } = await query(
      `SELECT p.id, p.nombre, p.sku, p.precio, p.moneda, p.descripcion,
              p.url_info, p.duracion, p.horas, p.num_modulos, p.modalidad,
              p.fecha_inicio_texto, p.image_url,
              p.presentacion_texto, p.objetivos_texto, p.beneficios_texto,
              p.dirigido_a_texto, p.para_que_te_prepara_texto, p.por_que_estudiar_texto,
              p.modulos_texto, p.metodologia_texto, p.faqs_texto, p.profesores_texto,
              p.otras_secciones, p.source_type, p.source_id, p.wc_product_id,
              p.created_at, p.updated_at,
              NULL::text AS categoria_nombre
       FROM products p
       WHERE p.project_id = $1 AND p.active = true
       ORDER BY p.id`,
      [projectId]
    );

    if (format === 'csv') {
      const cols = [
        'id','nombre','sku','precio','moneda','categoria_nombre','duracion','horas','num_modulos','modalidad',
        'fecha_inicio_texto','url_info','image_url',
        'presentacion_texto','objetivos_texto','beneficios_texto','dirigido_a_texto',
        'para_que_te_prepara_texto','por_que_estudiar_texto','modulos_texto','metodologia_texto',
        'faqs_texto','profesores_texto','source_type','source_id','wc_product_id'
      ];
      const lines = [cols.join(',')];
      for (const r of rows) lines.push(cols.map((c) => _csvEscape(r[c])).join(','));
      const csv = lines.join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="productos_proyecto_${projectId}_${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send('﻿' + csv);
    }

    res.json({
      success: true,
      data: rows,
      pagination: { total: rows.length, page: 1, limit: rows.length, totalPages: 1 },
    });
  } catch (err) { next(err); }
}

// GET /api/products/leads-stats?projectId=X
function _normalize(u) {
  if (!u) return null;
  return String(u).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('?')[0].split('#')[0].replace(/\/$/, '');
}

export async function leadsStats(req, res, next) {
  try {
    const projectId = req.projectId;
    const { rows: products } = await query(
      `SELECT id, nombre, url_info FROM products WHERE project_id = $1 AND active = true ORDER BY nombre`,
      [projectId]
    );
    const { rows: directs } = await query(
      `SELECT producto_interes_id AS pid, COUNT(*)::int AS n
       FROM leads WHERE project_id = $1 AND producto_interes_id IS NOT NULL
       GROUP BY producto_interes_id`,
      [projectId]
    );
    const directMap = new Map(directs.map(r => [r.pid, r.n]));

    const { rows: landings } = await query(
      `SELECT landing_url, COUNT(*)::int AS n
       FROM leads WHERE project_id = $1 AND landing_url IS NOT NULL AND landing_url <> ''
       GROUP BY landing_url`,
      [projectId]
    );
    const landingNorm = landings.map(r => ({ key: _normalize(r.landing_url), n: r.n, raw: r.landing_url }));

    const result = products.map(p => {
      const productKey = _normalize(p.url_info);
      const matches = productKey ? landingNorm.filter(l => l.key === productKey) : [];
      const url_match_count = matches.reduce((acc, m) => acc + m.n, 0);
      return {
        id: p.id,
        nombre: p.nombre,
        url_info: p.url_info,
        direct_count: directMap.get(p.id) || 0,
        url_match_count,
        total: (directMap.get(p.id) || 0) + url_match_count,
      };
    });

    const totalLeads = result.reduce((acc, r) => acc + r.total, 0);
    const unmatched = landingNorm.filter(l => !result.some(r => _normalize(r.url_info) === l.key))
      .reduce((acc, l) => acc + l.n, 0);

    res.json({ success: true, data: { products: result, total_leads: totalLeads, unmatched_url_leads: unmatched } });
  } catch (err) { next(err); }
}
