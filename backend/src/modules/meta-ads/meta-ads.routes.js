import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './meta-ads.controller.js';

const router = Router();
router.use(verifyToken);
// Toda configuración + lectura es admin/superadmin (publicidad es operativo, no del gestor).

// Multi-cuenta: el proyecto puede tener N cuentas. /accounts devuelve lista.
router.get('/accounts', puede('meta_ads.view'), ctrl.listAccounts);
// Legacy 1:1 — devuelve la primera, mantenido por retro-compat.
router.get('/account', puede('meta_ads.view'), ctrl.getAccount);
router.post('/connect', puede('meta_ads.edit'), ctrl.connect);
router.patch('/accounts/:accountId/token', puede('meta_ads.edit'), ctrl.updateToken);
router.delete('/accounts/:accountId', puede('meta_ads.edit'), ctrl.disconnect);
router.post('/accounts/:accountId/sync', puede('meta_ads.edit'), ctrl.syncNow);
router.post('/accounts/:accountId/backfill', puede('meta_ads.edit'), ctrl.backfill);

router.get('/campaigns', puede('meta_ads.view'), ctrl.listCampaigns);
router.get('/campaigns/:campaignId', puede('meta_ads.view'), ctrl.campaignDetail);
router.get('/campaigns/:campaignId/adsets', puede('meta_ads.view'), ctrl.listAdSets);
router.get('/adsets/:adsetId/ads', puede('meta_ads.view'), ctrl.listAds);
router.get('/dashboard', puede('meta_ads.view'), ctrl.dashboard);

router.get('/associations', puede('meta_ads.view'), ctrl.listAssociations);
router.post('/associations', puede('meta_ads.edit'), ctrl.setAssociations);
router.get('/adset-associations', puede('meta_ads.view'), ctrl.listAdSetAssociations);
router.post('/adset-associations', puede('meta_ads.edit'), ctrl.setAdSetAssociations);

router.get('/roi', puede('meta_ads.view'), ctrl.getRoi);
router.get('/products-view', puede('meta_ads.view'), ctrl.getProductsView);

export default router;
