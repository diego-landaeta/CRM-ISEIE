import { AppError } from '../../shared/utils/AppError.js';
import * as service from './diploma-confirmacion.service.js';
import { respuestaSchema, pedirSchema, estadosSchema, matriculaParamSchema } from './diploma-confirmacion.validation.js';

function parsear(schema, datos, mensaje = 'Datos no válidos') {
  const r = schema.safeParse(datos || {});
  if (!r.success) throw new AppError(mensaje, 400, 'VALIDATION_ERROR');
  return r.data;
}

// ── Públicas: la página, desde el enlace del correo ─────────────────────────

// GET /api/cd/:token
export async function formulario(req, res, next) {
  try {
    res.json({ success: true, data: await service.verFormulario(req.params.token) });
  } catch (err) { next(err); }
}

// POST /api/cd/:token
export async function responder(req, res, next) {
  try {
    const d = parsear(respuestaSchema, req.body, 'Revisa los datos del formulario');
    res.json({ success: true, data: await service.responder(req.params.token, d, req.ip) });
  } catch (err) { next(err); }
}

// ── Con sesión ───────────────────────────────────────────────────────────────

// POST /api/diploma-confirmacion/pedir  { matriculaIds }
export async function pedir(req, res, next) {
  try {
    const { matriculaIds } = parsear(pedirSchema, req.body);
    res.json({ success: true, data: { resultados: await service.pedir(req.user, matriculaIds) } });
  } catch (err) { next(err); }
}

// GET /api/diploma-confirmacion?matriculaIds=1,2,3
export async function estados(req, res, next) {
  try {
    const { matriculaIds } = parsear(estadosSchema, req.query);
    res.json({ success: true, data: await service.estados(req.user, matriculaIds) });
  } catch (err) { next(err); }
}

// POST /api/diploma-confirmacion/:matriculaId/reenviar
export async function reenviar(req, res, next) {
  try {
    const { matriculaId } = parsear(matriculaParamSchema, req.params);
    res.json({ success: true, data: await service.reenviar(req.user, matriculaId) });
  } catch (err) { next(err); }
}

// POST /api/diploma-confirmacion/:matriculaId/aplicar
export async function reaplicar(req, res, next) {
  try {
    const { matriculaId } = parsear(matriculaParamSchema, req.params);
    res.json({ success: true, data: await service.reaplicar(req.user, matriculaId) });
  } catch (err) { next(err); }
}
