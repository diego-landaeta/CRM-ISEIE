import { z } from 'zod';
import * as model from './sequence.model.js';
import { AppError } from '../../shared/utils/AppError.js';

const stepSchema = z.object({
  delay_hours: z.number().min(0),
  brevo_template_id: z.number().int().optional().nullable(),
  // CRM-185 fase 3: cada step puede usar una plantilla del modulo
  // email-templates en lugar de subject/body inline. Si template_id esta
  // presente, el scheduler la renderiza con el contexto del lead.
  template_id: z.number().int().positive().optional().nullable(),
  subject: z.string().max(200).optional(),
  body: z.string().optional(),
});

const createSchema = z.object({
  project_id: z.number().int().positive(),
  nombre: z.string().min(1).max(200),
  trigger_event: z.enum(['lead_created', 'status_changed', 'conversion_created', 'manual']),
  trigger_filter: z.record(z.string(), z.any()).optional(),
  steps: z.array(stepSchema).min(1),
  active: z.boolean().optional(),
});

const updateSchema = createSchema.partial().omit({ project_id: true });

export async function list(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
    const data = await model.findAll({ projectId });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const s = await model.findById(parseInt(req.params.id));
    if (!s) throw new AppError('Secuencia no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos: ' + parsed.error.issues[0]?.message, 400, 'VALIDATION_ERROR');
    // Nota: req.user.userId (ISEIE) en lugar de req.user.id del CRM hermano.
    const created = await model.create({ ...parsed.data, created_by: req.user.userId });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    const updated = await model.update(parseInt(req.params.id), parsed.data);
    if (!updated) throw new AppError('Secuencia no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try { await model.remove(parseInt(req.params.id)); res.json({ success: true }); }
  catch (err) { next(err); }
}

export async function listRuns(req, res, next) {
  try {
    const data = await model.listRuns({
      projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
      leadId: req.query.leadId ? parseInt(req.query.leadId) : null,
      sequenceId: req.query.sequenceId ? parseInt(req.query.sequenceId) : null,
      status: req.query.status,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function startManual(req, res, next) {
  try {
    const { sequence_id, lead_id } = req.body;
    if (!sequence_id || !lead_id) throw new AppError('sequence_id y lead_id requeridos', 400, 'VALIDATION_ERROR');
    const run = await model.startRun(parseInt(sequence_id), parseInt(lead_id));
    res.status(201).json({ success: true, data: run });
  } catch (err) { next(err); }
}

export async function stopRun(req, res, next) {
  try { await model.stopRun(parseInt(req.params.runId)); res.json({ success: true }); }
  catch (err) { next(err); }
}
