import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './meta-ads.controller.js';

const router = Router();
router.use(verifyToken);
// Toda configuración + lectura es admin/superadmin (publicidad es operativo, no del gestor).
router.use(roleGuard('admin', 'superadmin'));

// Multi-cuenta: el proyecto puede tener N cuentas. /accounts devuelve lista.
router.get('/accounts', ctrl.listAccounts);
// Legacy 1:1 — devuelve la primera, mantenido por retro-compat.
router.get('/account', ctrl.getAccount);
router.post('/connect', ctrl.connect);
router.patch('/accounts/:accountId/token', ctrl.updateToken);
router.delete('/accounts/:accountId', ctrl.disconnect);
router.post('/accounts/:accountId/sync', ctrl.syncNow);
router.post('/accounts/:accountId/backfill', ctrl.backfill);

router.get('/campaigns', ctrl.listCampaigns);
router.get('/campaigns/:campaignId', ctrl.campaignDetail);
router.get('/campaigns/:campaignId/adsets', ctrl.listAdSets);
router.get('/adsets/:adsetId/ads', ctrl.listAds);
router.get('/dashboard', ctrl.dashboard);

router.get('/associations', ctrl.listAssociations);
router.post('/associations', ctrl.setAssociations);
router.get('/adset-associations', ctrl.listAdSetAssociations);
router.post('/adset-associations', ctrl.setAdSetAssociations);

router.get('/roi', ctrl.getRoi);

export default router;
