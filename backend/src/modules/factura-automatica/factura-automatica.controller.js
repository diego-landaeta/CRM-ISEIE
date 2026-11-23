import { AppError } from '../../shared/utils/AppError.js';
import * as service from './factura-automatica.service.js';
import { activa, diasDePlazo } from './factura-automatica.config.js';
import { datosFiscalesSchema } from './factura-automatica.validation.js';

// ── Públicas: el formulario, desde el enlace del correo ─────────────────────

// GET /api/fd/:token
export async function formulario(req, res, next) {
  try {
    res.json({ success: true, data: await service.verFormulario(req.params.token) });
  } catch (err) { next(err); }
}

// POST /api/fd/:token
export async function responder(req, res, next) {
  try {
    const parsed = datosFiscalesSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError('Revisa los datos del formulario', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await service.responder(req.params.token, parsed.data, req.ip) });
  } catch (err) { next(err); }
}

// ── Con sesión ───────────────────────────────────────────────────────────────

const idDeVenta = (req) => {
  const id = Number(req.params.conversionId);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Venta no válida', 400, 'BAD_ID');
  return id;
};

// GET /api/factura-automatica/interruptor — ¿está encendida en este servidor?
// Lo pregunta el recorrido guiado (#856): apagada, dice que la enciende Diego.
// Solo el sí o el no y el plazo; la lista de campus se queda en el .env.
export function interruptor(req, res) {
  res.json({ success: true, data: { activa: activa(), dias: diasDePlazo() } });
}

// GET /api/factura-automatica/venta/:conversionId
export async function estado(req, res, next) {
  try {
    res.json({ success: true, data: await service.estadoDeLaVenta(idDeVenta(req)) });
  } catch (err) { next(err); }
}

// POST /api/factura-automatica/venta/:conversionId/reenviar
export async function reenviar(req, res, next) {
  try {
    res.json({ success: true, data: await service.reenviar(idDeVenta(req)) });
  } catch (err) { next(err); }
}
