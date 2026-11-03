import { z } from 'zod';
import * as model from './token.model.js';
import { applyMapping } from './mapeo.js';
import { recibirAdmision } from '../matriculas/admision.service.js';
import { conArchivos } from '../matriculas/admision.archivos.js';
import * as leadModel from '../leads/lead.model.js';
import { duplicadoParaAlta, apuntarReenvio, avisarDuplicado } from '../leads/duplicado-en-alta.js';
import { decidirFormulario, apuntarFormulario } from '../asignacion/asignacion.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { tieneRol } from '../../shared/utils/roles.js';
import { campusDeLaPersona } from '../../shared/utils/ambito.js';

/**
 * Cada admin, solo los webhooks de sus campus; el super admin, todos. Lo mismo que
 * el webhook de transferencias: un campus que no es suyo es un 403.
 */
async function comprobarCampus(req, projectId) {
  if (tieneRol(req.user, 'superadmin')) return;
  const mios = await campusDeLaPersona(req.user?.userId);
  if (!mios.includes(Number(projectId))) {
    throw new AppError('Ese campus no es tuyo: solo puedes usar los campus en los que estás.', 403, 'FORBIDDEN');
  }
}

/** El token, si existe y esta persona puede con él. */
async function elToken(req) {
  const t = await model.findById(parseInt(req.params.id));
  if (!t) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
  await comprobarCampus(req, t.project_id);
  return t;
}

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
    await comprobarCampus(req, projectId);
    res.json({ success: true, data: await model.listByProject(projectId, req.query.kind) });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    await comprobarCampus(req, parsed.data.project_id);
    res.status(201).json({ success: true, data: await model.create({ ...parsed.data, created_by: req.user.userId }) });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    await elToken(req);
    const r = await model.update(parseInt(req.params.id), parsed.data);
    if (!r) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await elToken(req);
    await model.remove(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function startListening(req, res, next) {
  try {
    await elToken(req);
    const t = await model.setListenMode(parseInt(req.params.id), true);
    if (!t) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
}

export async function stopListening(req, res, next) {
  try {
    await elToken(req);
    const t = await model.setListenMode(parseInt(req.params.id), false);
    if (!t) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
}

export async function getStatus(req, res, next) {
  try {
    const t = await elToken(req);
    res.json({ success: true, data: {
      awaiting_sample: t.awaiting_sample,
      sample_payload: t.sample_payload,
      sample_received_at: t.sample_received_at,
      field_mapping: t.field_mapping,
      uses_count: t.uses_count,
    }});
  } catch (err) { next(err); }
}

// PUBLICO: recibe payload via webhook token, crea entidad segun kind
export async function publicReceive(req, res, next) {
  try {
    // Ya lo buscó el portero (portero.js) antes de leer el envío; si se llega sin él, se busca aquí.
    const tok = req.webhookToken || await model.findByToken(req.params.token);
    if (!tok) throw new AppError('Token invalido o inactivo', 404, 'INVALID_TOKEN');

    // Modo escucha: capturar payload sin procesar
    if (tok.awaiting_sample) {
      // Con los archivos del multipart como marca, para mapearlos igual que el resto (#198).
      await model.saveSample(tok.id, conArchivos(req.body, req.files));
      return res.json({ success: true, data: { mode: 'listen', captured: true, message: 'Payload capturado. El admin puede mapearlo en el CRM.' } });
    }

    await model.recordUse(tok.id);

    // La solicitud de admisión (#198): datos, documentos y persona. Ver admision.service.js.
    if (tok.kind === 'matriculas') {
      const r = await recibirAdmision(tok, req.body || {}, req.files || []);
      return res.status(r.status).json({ success: true, data: r.data });
    }

    const mapped = applyMapping(req.body || {}, tok.field_mapping || {});

    if (tok.kind === 'leads') {
      if (!mapped.nombre || !mapped.email) throw new AppError('nombre y email requeridos tras mapeo', 400, 'VALIDATION_ERROR');
      const productoInteresId = mapped.producto_interes_id ? parseInt(mapped.producto_interes_id) : null;
      // Duplicados y reenvíos con la misma regla que el webhook de leads (29/10).
      const dup = await duplicadoParaAlta({ projectId: tok.project_id, email: mapped.email, telefono: mapped.telefono, productoInteresId });
      if (dup.reenvio) {
        const ya = await apuntarReenvio(dup, { notas: mapped.notas, origen: 'webhook con token' });
        return res.status(200).json({ success: true, data: { lead_id: ya.id, action: 'resent' } });
      }
      const porActividad = await decidirFormulario(tok.project_id);
      const lead = await leadModel.createLeadWithRoundRobin({
        projectId: tok.project_id,
        forcedResponsableId: porActividad?.elegida?.id || null,
        nombre: mapped.nombre,
        email: mapped.email,
        telefono: mapped.telefono || null,
        productoInteresId,
        notas: mapped.notas || null,
        duplicadoDe: dup.duplicadoDe,
        reincidente: dup.reincidente,
        landingUrl: mapped.landing_url || null,
        utms: { utm_source: mapped.utm_source || 'webhook', utm_medium: mapped.utm_medium || 'token', utm_campaign: mapped.utm_campaign || tok.token.slice(0, 20) },
        customFields: mapped.custom_fields || {},
      });
      avisarDuplicado(lead, dup, { origen: 'webhook con token', productoInteresId });
      await apuntarFormulario(porActividad, lead, { email: mapped.email, origen: 'webhook con token' });
      return res.status(201).json({ success: true, data: { lead_id: lead.id, action: dup.duplicadoDe ? 'created_duplicate' : 'created' } });
    }

    res.status(200).json({ success: true, data: { received: true, mapped: Object.keys(mapped) } });
  } catch (err) { next(err); }
}
