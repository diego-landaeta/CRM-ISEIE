import { z } from 'zod';
import * as model from './token.model.js';
import * as matriculaModel from '../matriculas/matricula.model.js';
import * as leadModel from '../leads/lead.model.js';
import { AppError } from '../../shared/utils/AppError.js';

const createSchema = z.object({
  project_id: z.number().int().positive(),
  kind: z.enum(['matriculas', 'leads', 'custom']),
  field_mapping: z.record(z.string(), z.string()).optional(),
  notas: z.string().max(500).optional(),
});

const updateSchema = z.object({
  active: z.boolean().optional(),
  field_mapping: z.record(z.string(), z.string()).optional(),
  notas: z.string().max(500).optional(),
}).refine(d => Object.keys(d).length > 0);

export async function list(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
    res.json({ success: true, data: await model.listByProject(projectId, req.query.kind) });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    res.status(201).json({ success: true, data: await model.create({ ...parsed.data, created_by: req.user.id }) });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    const r = await model.update(parseInt(req.params.id), parsed.data);
    if (!r) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try { await model.remove(parseInt(req.params.id)); res.json({ success: true }); }
  catch (err) { next(err); }
}

export async function startListening(req, res, next) {
  try {
    const t = await model.setListenMode(parseInt(req.params.id), true);
    if (!t) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
}

export async function stopListening(req, res, next) {
  try {
    const t = await model.setListenMode(parseInt(req.params.id), false);
    if (!t) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
}

export async function getStatus(req, res, next) {
  try {
    const t = await model.findById(parseInt(req.params.id));
    if (!t) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: {
      awaiting_sample: t.awaiting_sample,
      sample_payload: t.sample_payload,
      sample_received_at: t.sample_received_at,
      field_mapping: t.field_mapping,
      uses_count: t.uses_count,
    }});
  } catch (err) { next(err); }
}

function resolvePath(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

function applyMapping(body, mapping) {
  if (!mapping || Object.keys(mapping).length === 0) return body;
  const out = {};
  for (const [target, source] of Object.entries(mapping)) {
    const v = resolvePath(body, source);
    if (v !== undefined) out[target] = v;
  }
  return out;
}

// PUBLICO: recibe payload via webhook token, crea entidad segun kind
export async function publicReceive(req, res, next) {
  try {
    const tok = await model.findByToken(req.params.token);
    if (!tok) throw new AppError('Token invalido o inactivo', 404, 'INVALID_TOKEN');

    // Modo escucha: capturar payload sin procesar
    if (tok.awaiting_sample) {
      await model.saveSample(tok.id, req.body || {});
      return res.json({ success: true, data: { mode: 'listen', captured: true, message: 'Payload capturado. El admin puede mapearlo en el CRM.' } });
    }

    const mapped = applyMapping(req.body || {}, tok.field_mapping || {});
    await model.recordUse(tok.id);

    if (tok.kind === 'matriculas') {
      // Dedupe por DNI o email
      const dedupe = mapped.dni || mapped.email || null;
      if (dedupe) {
        const existing = await matriculaModel.findByDedupe(tok.project_id, dedupe);
        if (existing) {
          return res.status(200).json({ success: true, data: { matricula_id: existing.id, action: 'duplicate_skipped' } });
        }
      }
      const created = await matriculaModel.create({
        project_id: tok.project_id,
        dni: mapped.dni || null,
        titulo: mapped.titulo || null,
        notas: mapped.notas || null,
        datos_admision: req.body,
        source: 'webhook',
        dedupe_key: dedupe,
        estado: 'solicitud_admision',
      });
      return res.status(201).json({ success: true, data: { matricula_id: created.id, action: 'created' } });
    }

    if (tok.kind === 'leads') {
      if (!mapped.nombre || !mapped.email) throw new AppError('nombre y email requeridos tras mapeo', 400, 'VALIDATION_ERROR');
      const lead = await leadModel.createLeadWithRoundRobin({
        projectId: tok.project_id,
        nombre: mapped.nombre,
        email: mapped.email,
        telefono: mapped.telefono || null,
        productoInteresId: mapped.producto_interes_id ? parseInt(mapped.producto_interes_id) : null,
        notas: mapped.notas || null,
        landingUrl: mapped.landing_url || null,
        utms: { utm_source: mapped.utm_source || 'webhook', utm_medium: mapped.utm_medium || 'token', utm_campaign: mapped.utm_campaign || tok.token.slice(0, 20) },
        customFields: mapped.custom_fields || {},
      });
      return res.status(201).json({ success: true, data: { lead_id: lead.id, action: 'created' } });
    }

    res.status(200).json({ success: true, data: { received: true, mapped: Object.keys(mapped) } });
  } catch (err) { next(err); }
}
