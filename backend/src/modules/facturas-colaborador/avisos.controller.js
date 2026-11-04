import * as service from './avisos.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { opinionDelPagoSchema } from './facturas-colaborador.validation.js';

/*
  «He recibido el pago y lo confirmo» (Diego, 04/11): las rutas del enlace del
  correo de «Factura pagada». Sin usuario: la firma del enlace es la llave.
*/

const accion = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

const ipDe = (req) => req.ip;

export const verPago = accion(async (req, res) => {
  res.json({ success: true, data: await service.verPago(req.params.token) });
});

export const confirmarPago = accion(async (req, res) => {
  res.json({ success: true, data: await service.confirmarPago(req.params.token, ipDe(req)) });
});

export const opinarDelPago = accion(async (req, res) => {
  const r = opinionDelPagoSchema.safeParse(req.body ?? {});
  if (!r.success) throw new AppError(r.error.errors[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
  res.json({ success: true, data: await service.opinarDelPago(req.params.token, r.data, ipDe(req)) });
});
