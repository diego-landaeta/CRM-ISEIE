import * as Proceso from './proceso.service.js';
import { crearPasoSchema, editarPasoSchema, reordenarSchema } from './proceso.validation.js';

export async function listarPasos(req, res, next) {
  try {
    const pasos = await Proceso.listarPasos(req.projectId, {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ success: true, data: pasos });
  } catch (err) { next(err); }
}

export async function crearPaso(req, res, next) {
  try {
    const datos = crearPasoSchema.parse(req.body);
    const paso = await Proceso.crearPaso(req.projectId, datos);
    res.status(201).json({ success: true, data: paso });
  } catch (err) { next(err); }
}

export async function editarPaso(req, res, next) {
  try {
    const datos = editarPasoSchema.parse(req.body);
    const paso = await Proceso.editarPaso(Number(req.params.id), req.projectId, datos);
    res.json({ success: true, data: paso });
  } catch (err) { next(err); }
}

export async function reordenarPasos(req, res, next) {
  try {
    const { ids } = reordenarSchema.parse(req.body);
    const pasos = await Proceso.reordenarPasos(req.projectId, ids);
    res.json({ success: true, data: pasos });
  } catch (err) { next(err); }
}

export async function desactivarPaso(req, res, next) {
  try {
    const paso = await Proceso.desactivarPaso(Number(req.params.id), req.projectId);
    res.json({ success: true, data: paso });
  } catch (err) { next(err); }
}
