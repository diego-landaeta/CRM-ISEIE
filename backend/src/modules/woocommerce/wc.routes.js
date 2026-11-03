import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './wc.controller.js';
import * as pedidos from './wc.pedidos.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/credentials', puede('woocommerce.view'), ctrl.getCreds);
router.put('/credentials', puede('woocommerce.edit'), ctrl.upsertCreds);
router.delete('/credentials', puede('woocommerce.edit'), ctrl.deleteCreds);

router.get('/mappings', puede('woocommerce.view'), ctrl.listMappings);
router.put('/mappings', puede('woocommerce.edit'), ctrl.setMappings);

router.get('/runs', puede('woocommerce.view'), ctrl.listRuns);
router.get('/runs/current', puede('woocommerce.view'), ctrl.getCurrentRun);
router.post('/runs/start', puede('woocommerce.sync'), ctrl.importNow);
router.post('/auto-discover-cpts', puede('woocommerce.sync'), ctrl.autoDiscoverCpts);
router.get('/preview', puede('woocommerce.view'), ctrl.previewWc);
router.put('/mapping', puede('woocommerce.edit'), ctrl.saveMapping);
router.post('/scrape-preview', puede('woocommerce.sync'), ctrl.scrapePreview);

// Pedidos (#14). El aviso de WooCommerce entra por wc.webhook.js (sin sesión, con firma).
router.get('/orders', puede('woocommerce.pedidos'), pedidos.listar);
router.post('/sync/orders', puede('woocommerce.pedidos'), pedidos.sincronizar);
router.put('/orders-config', puede('woocommerce.pedidos'), pedidos.configurar);
router.post('/webhook-secret', puede('woocommerce.pedidos'), pedidos.secretoDelAviso);

export default router;
