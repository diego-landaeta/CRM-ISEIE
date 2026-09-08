import * as Proceso from './proceso.service.js';
import { crearPasoSchema, editarPasoSchema, reordenarSchema, ajustarPasoSchema } from './proceso.validation.js';

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

// ── LA AGENDA DE CADA PROSPECTO (#89 · #90) ─────────────────────────────────

// De quien es la cola. Se decide AQUI y no con lo que llegue por la URL: una
// gestora solo ve lo suyo aunque escriba el id de otra a mano. Admin y
// superadmin ven todo, o el de una en concreto si lo piden.
function deQuienEsLaCola(req) {
  const rol = req.user?.role;
  if (rol === 'admin' || rol === 'superadmin') {
    return req.query.gestoraId ? Number(req.query.gestoraId) : null;
  }
  return req.user?.userId || -1;
}

// Que proyectos entran. Sin `projectId` no se filtra por proyecto, que es la
// vista de «todos». No abre ninguna puerta: a una gestora la acota su propio
// recorte, y quien no es gestora ya puede ver todos los proyectos.
function proyectosDeLaCola(req) {
  const uno = Number(req.query.projectId);
  return Number.isInteger(uno) && uno > 0 ? [uno] : null;
}

export async function cola(req, res, next) {
  try {
    const data = await Proceso.colaDelDia({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      hasta: /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : null,
      limite: Number(req.query.limite) || 200,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function resumenCola(req, res, next) {
  try {
    const data = await Proceso.resumenDeLaCola({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function pasosDeUnLead(req, res, next) {
  try {
    const data = await Proceso.pasosDeLead(Number(req.params.leadId));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function replanificar(req, res, next) {
  try {
    const cuantos = await Proceso.planificarPasosDeLead(Number(req.params.leadId));
    res.json({ success: true, data: { creados: cuantos } });
  } catch (err) { next(err); }
}

export async function ajustarPasoDeLead(req, res, next) {
  try {
    const datos = ajustarPasoSchema.parse(req.body);
    const paso = await Proceso.ajustarPaso(Number(req.params.id), datos);
    res.json({ success: true, data: paso });
  } catch (err) { next(err); }
}
