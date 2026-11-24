import { AppError } from '../../shared/utils/AppError.js';
import * as service from './factura-automatica.service.js';
import { activa, diasDePlazo, enviarPdf } from './factura-automatica.config.js';
import { datosFiscalesSchema, envioFacturaSchema, panelSchema } from './factura-automatica.validation.js';
import * as envio from './factura-automatica.envio.js';
import * as model from './factura-automatica.model.js';
import { panel as panelDe } from './factura-automatica.panel.js';
import { listaDelAmbito } from '../../shared/utils/ambito.js';
import { alcanceComercial } from '../../shared/utils/roles.js';
import { logger } from '../../shared/utils/logger.js';

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

// ── «Enviar factura automáticamente: Sí / No» y «Enviar a este correo» (24/11) ──

// GET /api/factura-automatica/venta/:conversionId/envio
// Lo que eligió la gestora, el correo de la ficha y en qué está el formulario.
export async function verEnvio(req, res, next) {
  try {
    const id = idDeVenta(req);
    const data = await envio.envioDeLaVenta(id);
    if (!data) throw new AppError('Venta no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: { ...data, activa: activa(), peticion: await service.estadoDeLaVenta(id) } });
  } catch (err) { next(err); }
}

// PUT /api/factura-automatica/venta/:conversionId/envio  { auto, email }
// Si el formulario aún espera y el correo cambia, se le manda de nuevo al
// correo bueno: «el formulario y el PDF van al correo confirmado» (Diego).
export async function guardarEnvio(req, res, next) {
  try {
    const id = idDeVenta(req);
    const parsed = envioFacturaSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const data = await envio.guardarEnLaVenta(id, parsed.data, req.user.userId);
    if (!data) throw new AppError('Venta no encontrada', 404, 'NOT_FOUND');
    let formularioReenviado = false;
    const peticion = await model.deLaVenta(id);
    const antes = String(peticion?.enviado_a || '').trim().toLowerCase();
    if (peticion && ['pendiente', 'revision'].includes(peticion.estado) && data.email_efectivo
      && antes !== data.email_efectivo) {
      try {
        formularioReenviado = !!(await service.reenviar(id))?.enviado;
      } catch (err) {
        // Apagada en el campus o ya contestado: se guarda igual, sin reenviar.
        logger.info({ err: err.message, conversionId: id }, 'factura automática: correo cambiado sin reenviar el formulario');
      }
    }
    res.json({ success: true, data: { ...data, formulario_reenviado: formularioReenviado } });
  } catch (err) { next(err); }
}

// GET /api/factura-automatica/panel?projectId=|issuerId=|projectIds=
// Formularios, facturas que salieron solas y lo que espera a una persona.
export async function panel(req, res, next) {
  try {
    const q = panelSchema.parse(req.query || {});
    const projectIds = await listaDelAmbito(req);
    const personas = await alcanceComercial(req.user);
    const data = await panelDe({ projectIds, personas, limite: q.limite || 200 });
    res.json({ success: true, data: { ...data, activa: activa(), dias: diasDePlazo(), enviar_pdf: enviarPdf() } });
  } catch (err) { next(err); }
}
