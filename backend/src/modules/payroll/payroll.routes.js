import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './payroll.controller.js';

const router = Router();
router.use(verifyToken);

// Plans
router.get('/plans', ctrl.listPlans);
router.put('/plans', roleGuard('admin', 'superadmin'), ctrl.upsertPlan);
router.delete('/plans/:id', roleGuard('admin', 'superadmin'), ctrl.deletePlan);

// Hours
router.get('/hours', ctrl.listHours);
router.post('/hours', roleGuard('admin', 'superadmin', 'gestor'), ctrl.createHours);
router.delete('/hours/:id', roleGuard('admin', 'superadmin'), ctrl.deleteHours);

// Periods
router.get('/periods', ctrl.listPeriods);
router.get('/periods/:id', ctrl.getPeriod);
router.post('/periods/generate', roleGuard('admin', 'superadmin'), ctrl.generatePeriod);
router.post('/periods/:id/close', roleGuard('admin', 'superadmin'), ctrl.closePeriod);
router.post('/periods/:id/pay', roleGuard('admin', 'superadmin'), ctrl.payPeriod);

// Adjustments
router.post('/adjustments', roleGuard('admin', 'superadmin'), ctrl.addAdjustment);
router.delete('/adjustments/:id', roleGuard('admin', 'superadmin'), ctrl.deleteAdjustment);

export default router;
