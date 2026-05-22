import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './status.controller.js';

const router = Router();

// Endpoints públicos — sin auth
router.get('/', ctrl.getStatus);
router.get('/incidents', ctrl.getIncidents);

// Endpoints protegidos — solo soporte/admin
router.use(verifyToken);
router.post('/incidents', roleGuard('admin', 'superadmin'), ctrl.createIncident);
router.put('/incidents/:id', roleGuard('admin', 'superadmin'), ctrl.updateIncident);
router.put('/components/:slug', roleGuard('admin', 'superadmin'), ctrl.updateComponent);
router.get('/errors', roleGuard('admin', 'superadmin'), ctrl.getErrors);

export default router;
