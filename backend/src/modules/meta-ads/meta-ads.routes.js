import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './meta-ads.controller.js';
import * as portfolioCtrl from './meta-portfolio.controller.js';

const router = Router();
router.use(verifyToken);

/**
 * Ver (`meta_ads.view`) y configurar (`meta_ads.edit`), con el catálogo de la #423.
 * El equipo de desarrollo (Diego, 26/10/2026: Ruth, Julián, Jesús, Emmanuel —solo
 * CEDIA él—; en ISEIE, Jonathan y Gustavo) lo ve con `meta_ads.view` por persona.
 *
 * Y solo de SUS campus: el `projectId` que pide tiene que ser uno de los suyos.
 * Antes no se miraba —cualquiera con la clave podía pedir la publicidad de otra
 * empresa cambiando el número—. Superadmin y soporte ven todo el CRM.
 */
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
// Para el inventario de permisos (#423): acota por campus, no decide quién entra.
deSusCampus.regla = { tipo: 'alcance', nombre: 'deSusCampus' };
// El portfolio es del negocio entero, sin campus propio (#198, gemela de CRM#212): un
// admin limitado a su campus no debe poder conectar, listar, desconectar, sincronizar
// ni ignorar cuentas de un Business Manager que puede tocar campus ajenos. Solo quien
// ve el CRM entero (superadmin y soporte).
async function soloVeTodoElCrm(req, _res, next) {
  if (veTodoElCrm(req.user)) return next();
  return next(new AppError('No tienes acceso a este portfolio', 403, 'FORBIDDEN'));
}
soloVeTodoElCrm.regla = { tipo: 'alcance', nombre: 'soloVeTodoElCrm' };
const ver = [puede('meta_ads.view'), deSusCampus];
const configurar = [puede('meta_ads.edit'), deSusCampus];

// Multi-cuenta: el proyecto puede tener N cuentas. /accounts devuelve lista.
router.get('/accounts', ver, ctrl.listAccounts);
// Legacy 1:1 — devuelve la primera, mantenido por retro-compat.
router.get('/account', ver, ctrl.getAccount);
router.post('/connect', configurar, ctrl.connect);
router.patch('/accounts/:accountId/token', puede('meta_ads.edit'), ctrl.updateToken);
router.delete('/accounts/:accountId', puede('meta_ads.edit'), ctrl.disconnect);
router.post('/accounts/:accountId/sync', puede('meta_ads.edit'), ctrl.syncNow);
router.post('/accounts/:accountId/backfill', puede('meta_ads.edit'), ctrl.backfill);

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

// Portfolio de Meta (#198, gemela de CRM#212): el Business Manager entero, y la
// bandeja de cuentas que descubre. Solo admin (y superadmin, que ya lo tiene
// todo) — soporte no, a propósito (ver el permiso en catalogo.js).
const conectarPortfolio = puede('meta_ads.conectar_portfolio');
router.post('/portfolios', [conectarPortfolio, soloVeTodoElCrm], portfolioCtrl.connect);
router.get('/portfolios', [conectarPortfolio, soloVeTodoElCrm], portfolioCtrl.list);
router.delete('/portfolios/:portfolioId', [conectarPortfolio, soloVeTodoElCrm], portfolioCtrl.disconnect);
router.post('/portfolios/:portfolioId/sync', [conectarPortfolio, soloVeTodoElCrm], portfolioCtrl.sync);
router.get('/portfolios/:portfolioId/discovered', [conectarPortfolio, soloVeTodoElCrm], portfolioCtrl.listDiscovered);
// Asignar sí mira el campus: el project_id del body tiene que ser uno de los suyos.
router.post('/portfolios/discovered/:discoveredId/assign', [conectarPortfolio, deSusCampus], portfolioCtrl.assign);
router.post('/portfolios/discovered/:discoveredId/ignore', [conectarPortfolio, soloVeTodoElCrm], portfolioCtrl.ignore);

export default router;
