import express, { Router } from 'express';
import { recibirAviso } from './wc.orders.js';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * El aviso de WooCommerce cuando se crea o cambia un pedido (#14).
 *
 * Va APARTE del router del módulo: aquel exige sesión, y WooCommerce no tiene. Aquí
 * la puerta es la FIRMA (`X-WC-Webhook-Signature`: HMAC-SHA256 del cuerpo con el
 * secreto del campus), que obliga a leer el cuerpo EN BRUTO: por eso lleva su
 * propio parser y se monta antes que el `express.json` general.
 */
const router = Router();

router.post('/:projectId', express.raw({ type: '*/*', limit: '2mb' }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.projectId);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Firma no válida', 401, 'INVALID_SIGNATURE');
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const r = await recibirAviso(id, cuerpo, req.get('x-wc-webhook-signature'));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
});

export default router;
