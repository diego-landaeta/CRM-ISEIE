import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './meta-ads.controller.js';

const router = Router();
router.use(verifyToken);
// Toda configuración + lectura es admin/superadmin (publicidad es operativo, no del gestor).
router.use(roleGuard('admin', 'superadmin'));

router.get('/account', ctrl.getAccount);
router.post('/connect', ctrl.connect);
router.patch('/token', ctrl.updateToken);
router.delete('/disconnect', ctrl.disconnect);

router.post('/sync', ctrl.syncNow);
router.post('/backfill', ctrl.backfill);

router.get('/campaigns', ctrl.listCampaigns);
router.get('/campaigns/:campaignId', ctrl.campaignDetail);
router.get('/campaigns/:campaignId/adsets', ctrl.listAdSets);
router.get('/adsets/:adsetId/ads', ctrl.listAds);
router.get('/dashboard', ctrl.dashboard);

router.get('/associations', ctrl.listAssociations);
router.post('/associations', ctrl.setAssociations);

router.get('/roi', ctrl.getRoi);

export default router;
