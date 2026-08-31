import { z } from 'zod';
import * as service from './status.service.js';
import { comprobarTodo } from './piezas.service.js';
import { AppError } from '../../shared/utils/AppError.js';

const VALID_STATUSES = ['operational', 'degraded', 'partial', 'major', 'maintenance'];
const VALID_SEVERITIES = ['info', 'warning', 'critical'];
const VALID_INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];

const incidentSchema = z.object({
  title:       z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  severity:    z.enum(['info', 'warning', 'critical']).default('warning'),
  affects:     z.array(z.string()).default([]),
});

const updateIncidentSchema = z.object({
  title:       z.string().min(1).max(300).optional(),
  description: z.string().max(2000).optional(),
  severity:    z.enum(['info', 'warning', 'critical']).optional(),
  status:      z.enum(['investigating', 'identified', 'monitoring', 'resolved']).optional(),
  affects:     z.array(z.string()).optional(),
});

const componentSchema = z.object({
  status: z.enum(['operational', 'degraded', 'partial', 'major', 'maintenance']),
});

// GET /api/status — público, sin auth
export async function getStatus(req, res, next) {
  try {
    const data = await service.getSystemStatus();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /api/status/incidents — público
export async function getIncidents(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const data = await service.getIncidentHistory(limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// POST /api/status/incidents — soporte/admin
export async function createIncident(req, res, next) {
  try {
    const parsed = incidentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const incident = await service.createIncident({ ...parsed.data, created_by: req.user.userId });
    res.status(201).json({ success: true, data: incident });
  } catch (err) { next(err); }
}

// PUT /api/status/incidents/:id — soporte/admin
export async function updateIncident(req, res, next) {
  try {
    const parsed = updateIncidentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const incident = await service.updateIncident(req.params.id, parsed.data);
    if (!incident) throw new AppError('Incidente no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: incident });
  } catch (err) { next(err); }
}

// PUT /api/status/components/:slug — soporte/admin
export async function updateComponent(req, res, next) {
  try {
    const parsed = componentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const component = await service.updateComponent(req.params.slug, parsed.data.status);
    if (!component) throw new AppError('Componente no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: component });
  } catch (err) { next(err); }
}

// GET /api/status/errors — soporte/admin
export async function getErrors(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const data = await service.getErrors(limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * GET /api/status/correos — que correos intento mandar el CRM.
 *
 * Es la cuarta subfase de la tarea #27. Sin esto, comprobar que el freno de
 * pruebas o los reintentos funcionan exige entrar a Postgres — y entonces no lo
 * comprueba nadie, que es exactamente lo que pasaba con los 3.133 intentos
 * perdidos: estaban en el log del servidor y nadie los miro.
 *
 * Protegido como los errores: quien puede ver esto ve direcciones de clientes.
 */
export async function getCorreos(req, res, next) {
  try {
    const { ultimosEnvios, resumenEnvios } = await import('../../shared/services/email-log.service.js');
    const estado = ['enviado', 'fallido', 'bloqueado'].includes(req.query.estado)
      ? req.query.estado
      : null;
    const [envios, resumen] = await Promise.all([
      ultimosEnvios({ estado, limite: req.query.limit }),
      resumenEnvios(),
    ]);
    res.json({ success: true, data: { envios, resumen } });
  } catch (err) { next(err); }
}

/**
 * Como esta cada pieza AHORA, tarea #26.
 *
 * Separado a proposito de `getStatus`, que es la pagina publica de incidencias
 * al estilo statuspage.io —componentes que alguien marca a mano y avisos
 * escritos por una persona—. Esto es lo contrario: nadie lo escribe, se mide.
 *
 * Nunca contesta 500. Una pieza rota se pinta rota; que la pantalla de estado
 * se caiga cuando algo va mal es justo el dia que hace falta.
 */
export async function getPiezas(req, res, next) {
  try {
    res.json({ success: true, data: await comprobarTodo() });
  } catch (err) {
    next(err);
  }
}
