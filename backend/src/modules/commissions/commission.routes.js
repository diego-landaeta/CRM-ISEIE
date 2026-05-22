import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './commission.controller.js';

const router = Router();
router.use(verifyToken);

// Reglas (solo superadmin)
router.get('/rules', roleGuard('admin', 'superadmin'), ctrl.listRules);
router.post('/rules', roleGuard('superadmin'), ctrl.createRule);
router.patch('/rules/:id', roleGuard('superadmin'), ctrl.updateRule);
router.delete('/rules/:id', roleGuard('superadmin'), ctrl.deleteRule);

// Vista del propio gestor
router.get('/me', ctrl.listMine);
router.get('/me/stats', ctrl.statsMine);

// Vista admin/superadmin
router.get('/', roleGuard('admin', 'superadmin'), ctrl.listAll);
router.get('/stats', roleGuard('admin', 'superadmin'), ctrl.statsAll);

// Pagar comision (admin/superadmin)
router.patch('/:id/pay', roleGuard('admin', 'superadmin'), ctrl.pay);

// Recalcular comision desde conversion (admin/superadmin)
router.post('/recalculate/:conversionId', roleGuard('admin', 'superadmin'), ctrl.recalculate);

export default router;
