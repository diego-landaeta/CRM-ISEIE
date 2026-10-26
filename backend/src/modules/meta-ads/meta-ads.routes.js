import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { rolOPermiso } from '../../shared/middleware/permissions.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './meta-ads.controller.js';

const router = Router();
router.use(verifyToken);

// Configurar (conectar, token, sincronizar, asociar): admin/superadmin, como siempre.
const soloAdmin = roleGuard('admin', 'superadmin');

/**
 * VER Meta Ads (26/10/2026, Diego: «en Meta tendrán acceso Ruth, Julián, Jesús,
 * Emmanuel —solo CEDIA él—; en ISEIE, Jonathan y Gustavo»): el admin, el
 * superadmin y soporte por su rol, y quien tenga `meta_ads.view` (una
 * excepción suya o de su rol), en solo lectura.
 *
 * Y solo de SUS campus: el `projectId` que pide tiene que ser uno de los suyos.
 * Antes no se miraba —cualquier admin podía pedir la publicidad de otra
 * empresa cambiando el número—. Superadmin y soporte ven todo el CRM.
 */
const puedeVer = rolOPermiso(['admin', 'superadmin', 'soporte'], 'meta_ads', 'view');
async function deSusCampus(req, _res, next) {
  try {
    if (veTodoElCrm(req.user)) return next();
    const pedido = Number(req.query.projectId || req.body?.project_id);
    if (!pedido) return next(); // el controlador responde 400 «projectId requerido»
    const mios = await campusDeLaPersona(req.user.userId);
    if (!mios.includes(pedido)) return next(new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN'));
    next();
  } catch (err) { next(err); }
}
const ver = [puedeVer, deSusCampus];
const configurar = [soloAdmin, deSusCampus];

// Multi-cuenta: el proyecto puede tener N cuentas. /accounts devuelve lista.
router.get('/accounts', ver, ctrl.listAccounts);
// Legacy 1:1 — devuelve la primera, mantenido por retro-compat.
router.get('/account', ver, ctrl.getAccount);
router.post('/connect', configurar, ctrl.connect);
router.patch('/accounts/:accountId/token', soloAdmin, ctrl.updateToken);
router.delete('/accounts/:accountId', soloAdmin, ctrl.disconnect);
router.post('/accounts/:accountId/sync', soloAdmin, ctrl.syncNow);
router.post('/accounts/:accountId/backfill', soloAdmin, ctrl.backfill);

router.get('/campaigns', ver, ctrl.listCampaigns);
router.get('/campaigns/:campaignId', ver, ctrl.campaignDetail);
router.get('/campaigns/:campaignId/adsets', ver, ctrl.listAdSets);
router.get('/adsets/:adsetId/ads', ver, ctrl.listAds);
router.get('/dashboard', ver, ctrl.dashboard);

router.get('/associations', ver, ctrl.listAssociations);
router.post('/associations', configurar, ctrl.setAssociations);
router.get('/adset-associations', ver, ctrl.listAdSetAssociations);
router.post('/adset-associations', configurar, ctrl.setAdSetAssociations);

router.get('/roi', ver, ctrl.getRoi);
router.get('/products-view', ver, ctrl.getProductsView);

export default router;
