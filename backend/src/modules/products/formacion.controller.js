import { tienePermiso } from '../../shared/middleware/permissions.js';
import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as Formacion from './formacion.service.js';
import { campusConectado, llevarAMoodle as llevar, moodleDisponible } from './formacion.moodle.js';

/**
 * Productos › Formaciones (CRM#1113): crear y editar una formación con sus
 * módulos desde una sola pantalla. El campus lo fija `projectAccess` (solo los
 * de quien pide) y el servicio comprueba que la formación sea de ese campus.
 */

const ver = async (req, id) => {
  const [formacion, puedeMoodle, conectado] = await Promise.all([
    Formacion.verFormacion(id, req.projectId, { conPorcentajes: await tienePermiso(req, 'tutores.gestionar') }),
    tienePermiso(req, 'moodle.crear_cursos'),
    campusConectado(req.projectId),
  ]);
  // Fase 2: si se puede llevar a Moodle desde aquí (interruptor + plugin + permiso) y si el
  // campus tiene su Moodle conectado. La pantalla solo enseña el botón con las dos cosas.
  return { ...formacion, moodle: { disponible: moodleDisponible() && puedeMoodle, conectado } };
};

// GET /api/products/:id/formacion?projectId=
export async function verFormacion(req, res, next) {
  try {
    res.json({ success: true, data: await ver(req, Number(req.params.id)) });
  } catch (err) { next(err); }
}

// POST /api/products/formacion  { projectId, nombre, tipo_formacion, …, modulos: [] }
export async function crearFormacion(req, res, next) {
  try {
    const id = await Formacion.crearFormacion(req.projectId, req.body, { userId: req.user?.userId, ip: req.ip });
    res.status(201).json({ success: true, data: await ver(req, id) });
  } catch (err) { next(err); }
}

// PUT /api/products/:id/formacion  { projectId, nombre, …, modulos: [{ id?, titulo, horas, descripcion }] }
export async function guardarFormacion(req, res, next) {
  try {
    const id = Number(req.params.id);
    await Formacion.guardarFormacion(id, req.projectId, req.body, { userId: req.user?.userId, ip: req.ip });
    res.json({ success: true, data: await ver(req, id) });
  } catch (err) { next(err); }
}

const moodleSchema = z.object({ categoria: z.coerce.number().int().nonnegative().optional() });

// POST /api/products/:id/formacion/moodle  { projectId, categoria? }
// Fase 2 (CRM#1113): crea o actualiza su curso de Moodle, con una sección por módulo.
export async function llevarAMoodle(req, res, next) {
  try {
    const d = moodleSchema.safeParse(req.body || {});
    if (!d.success) throw new AppError('Categoría inválida', 400, 'VALIDATION_ERROR');
    const id = Number(req.params.id);
    const curso = await llevar(id, req.projectId, { categoria: d.data.categoria || 0, userId: req.user?.userId, ip: req.ip });
    res.json({ success: true, data: { curso, formacion: await ver(req, id) } });
  } catch (err) { next(err); }
}
