import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './commission.controller.js';

const router = Router();
router.use(verifyToken);

// Reglas (solo superadmin)
router.get('/rules', puede('commissions.view'), ctrl.listRules);
router.post('/rules', puede('commissions.reglas'), ctrl.createRule);
router.patch('/rules/:id', puede('commissions.reglas'), ctrl.updateRule);
router.delete('/rules/:id', puede('commissions.reglas'), ctrl.deleteRule);

// Vista del propio gestor
router.get('/me', ctrl.listMine);
router.get('/me/stats', ctrl.statsMine);

// Vista admin/superadmin
router.get('/', puede('commissions.view'), ctrl.listAll);
router.get('/stats', puede('commissions.view'), ctrl.statsAll);

// Pagar comision (admin/superadmin)
router.patch('/:id/pay', puede('commissions.pagar'), ctrl.pay);

// Recalcular comision desde conversion (admin/superadmin)
router.post('/recalculate/:conversionId', puede('commissions.edit'), ctrl.recalculate);

export default router;
