import express, { Router } from 'express';
import { logger } from '../../shared/utils/logger.js';
import { firmaValida } from './tasks.github.js';
import { leerSecretos, procesarAviso } from './tasks.github.service.js';

/**
 * El webhook de GitHub (CRM-ISEIE#435): `POST /api/github/webhook`.
 *
 * Va APARTE del router del tablero (aquel pide sesión y GitHub no tiene) y se
 * monta antes del `express.json` general: la puerta es la FIRMA
 * (`X-Hub-Signature-256`, HMAC SHA-256 del cuerpo con el secreto guardado
 * cifrado en Credenciales), que obliga a leer el cuerpo EN BRUTO. La firma se
 * comprueba ANTES de leer el JSON o tocar la base; una firma mala es un 401 y
 * no se mira nada más.
 *
 * Solo se monta con GITHUB_TABLERO_ACTIVO encendido (app.js): apagado, 404.
 */
const router = Router();

router.post('/', express.raw({ type: '*/*', limit: '5mb' }), async (req, res, next) => {
  try {
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const { webhook_secret: secreto } = await leerSecretos();
    if (!firmaValida(secreto, cuerpo, req.get('x-hub-signature-256'))) {
      logger.warn({ evento: req.get('x-github-event') || null }, 'GitHub: aviso con firma no válida');
      return res.status(401).json({ success: false, error: 'Firma no válida', code: 'INVALID_SIGNATURE' });
    }
    let payload;
    try {
      payload = JSON.parse(cuerpo.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, error: 'El aviso no es JSON', code: 'INVALID_JSON' });
    }
    const r = await procesarAviso({
      evento: req.get('x-github-event') || '',
      entrega: req.get('x-github-delivery') || null,
      payload,
    });
    res.json({ success: true, data: r });
  } catch (err) {
    next(err);
  }
});

export default router;
