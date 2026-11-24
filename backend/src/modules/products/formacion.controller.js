import { tienePermiso } from '../../shared/middleware/permissions.js';
import * as Formacion from './formacion.service.js';

/**
 * Productos › Formaciones (CRM#1113): crear y editar una formación con sus
 * módulos desde una sola pantalla. El campus lo fija `projectAccess` (solo los
 * de quien pide) y el servicio comprueba que la formación sea de ese campus.
 */

const ver = async (req, id) => Formacion.verFormacion(id, req.projectId, {
  conPorcentajes: await tienePermiso(req, 'tutores.gestionar'),
});

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
