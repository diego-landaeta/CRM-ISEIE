import { z } from 'zod';
import * as Service from './email-templates.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';

const createSchema = z.object({
  name:        z.string().min(1).max(120),
  subject:     z.string().min(1).max(500),
  body_html:   z.string().min(1).max(50000),
  description: z.string().max(1000).optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  active: z.boolean().optional(),
});

export async function list(req, res, next) {
  try {
    const includeInactive = req.query.includeInactive === 'true';
    const templates = await Service.listByProject(req.projectId, { includeInactive });
    res.json({ success: true, data: templates });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const tpl = await Service.getById(Number(req.params.id), req.projectId);
    res.json({ success: true, data: tpl });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const tpl = await Service.create({
      ...parsed.data,
      projectId: req.projectId,
      userId: req.user.userId,
    });
    res.status(201).json({ success: true, data: tpl });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const tpl = await Service.update(Number(req.params.id), req.projectId, parsed.data);
    res.json({ success: true, data: tpl });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await Service.remove(Number(req.params.id), req.projectId);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// GET /catalog: lista de variables disponibles (frontend lo usa para el editor).
export async function getVariables(_req, res) {
  res.json({ success: true, data: Service.TEMPLATE_VARIABLES });
}

// POST /:id/render: render preview con un leadId opcional para previsualizar.
const previewSchema = z.object({ leadId: z.number().int().positive().optional() });

export async function preview(req, res, next) {
  try {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('leadId invalido', 400, 'VALIDATION_ERROR');
    const tpl = await Service.getById(Number(req.params.id), req.projectId);

    // Construir contexto. Si hay leadId real, lo cargamos; si no, datos demo.
    let ctx = {
      lead:    { nombre: 'Nombre Apellido', email: 'lead@ejemplo.com', telefono: '+34 600 000 000', producto: 'Curso demo' },
      project: { nombre: 'Proyecto demo' },
      user:    { nombre: req.user?.nombre || 'Usuario' },
    };
    if (parsed.data.leadId) {
      const { rows } = await query(
        `SELECT l.nombre, l.email, l.telefono, l.producto_interes, p.nombre AS project_nombre
         FROM leads l JOIN projects p ON p.id = l.project_id
         WHERE l.id = $1 AND l.project_id = $2`,
        [parsed.data.leadId, req.projectId]
      );
      const lead = rows[0];
      if (lead) {
        ctx = {
          lead: {
            nombre: lead.nombre || '',
            email: lead.email || '',
            telefono: lead.telefono || '',
            producto: lead.producto_interes || '',
          },
          project: { nombre: lead.project_nombre },
          user: { nombre: req.user?.nombre || 'Usuario' },
        };
      }
    }

    res.json({
      success: true,
      data: {
        subject:   Service.renderTemplate(tpl.subject, ctx),
        body_html: Service.renderTemplate(tpl.body_html, ctx),
      },
    });
  } catch (err) { next(err); }
}
