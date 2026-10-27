import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './payroll.controller.js';

const router = Router();
router.use(verifyToken);

// Plans
// Las nominas son cosa de administracion. Estos GET no llevaban guard y el
// userId salia de la query sin forzarse: cualquiera con sesion podia pedir
// el sueldo de otra persona.
router.get('/plans', puede('payroll.view'), ctrl.listPlans);
router.put('/plans', puede('payroll.edit'), ctrl.upsertPlan);
router.delete('/plans/:id', puede('payroll.delete'), ctrl.deletePlan);

// Hours
router.get('/hours', puede('payroll.view'), ctrl.listHours);
router.post('/hours', puede('payroll.create'), ctrl.createHours);
router.delete('/hours/:id', puede('payroll.delete'), ctrl.deleteHours);

// Periods
router.get('/periods', puede('payroll.view'), ctrl.listPeriods);
router.get('/periods/:id', puede('payroll.view'), ctrl.getPeriod);
router.post('/periods/generate', puede('payroll.edit'), ctrl.generatePeriod);
router.post('/periods/:id/close', puede('payroll.edit'), ctrl.closePeriod);
router.post('/periods/:id/pay', puede('payroll.edit'), ctrl.payPeriod);

// Adjustments
router.post('/adjustments', puede('payroll.edit'), ctrl.addAdjustment);
router.delete('/adjustments/:id', puede('payroll.delete'), ctrl.deleteAdjustment);

export default router;
