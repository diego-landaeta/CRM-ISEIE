import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './wc.controller.js';

const router = Router();
router.use(verifyToken);
router.use(roleGuard('admin', 'superadmin'));

router.get('/credentials', ctrl.getCreds);
router.put('/credentials', ctrl.upsertCreds);
router.delete('/credentials', ctrl.deleteCreds);

router.get('/mappings', ctrl.listMappings);
router.put('/mappings', ctrl.setMappings);

router.get('/runs', ctrl.listRuns);
router.get('/runs/current', ctrl.getCurrentRun);
router.post('/runs/start', ctrl.importNow);
router.post('/auto-discover-cpts', ctrl.autoDiscoverCpts);
router.get('/preview', ctrl.previewWc);
router.put('/mapping', ctrl.saveMapping);
router.post('/scrape-preview', ctrl.scrapePreview);

export default router;
