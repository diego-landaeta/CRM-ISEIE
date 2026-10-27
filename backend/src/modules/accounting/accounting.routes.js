import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './accounting.controller.js';

const router = Router();

router.use(verifyToken);

// Dashboard accounting (admin y superadmin, NO gestor)
router.get('/dashboard', puede('accounting.view'), ctrl.dashboard);

// Cuentas por cobrar (admin, superadmin y gestor — la gestora solo ve las suyas)
router.get('/receivable', puede('accounting.por_cobrar'), ctrl.receivable);

// Los egresos viven en su propio módulo (`modules/expenses`, #227), igual en
// los dos CRM. /api/accounting/expenses sigue respondiendo como alias suyo.

export default router;
