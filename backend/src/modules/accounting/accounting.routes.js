import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './accounting.controller.js';

const router = Router();

router.use(verifyToken);

// Dashboard accounting (admin y superadmin, NO gestor)
router.get('/dashboard', roleGuard('admin', 'superadmin'), ctrl.dashboard);

// Cuentas por cobrar (admin, superadmin y gestor — la gestora solo ve las suyas)
router.get('/receivable', roleGuard('admin', 'superadmin', 'soporte', 'gestor'), ctrl.receivable);

// Expenses CRUD (admin y superadmin)
router.get('/expenses', roleGuard('admin', 'superadmin'), ctrl.listExpenses);
router.get('/expenses/:id', roleGuard('admin', 'superadmin'), ctrl.getExpense);
router.post('/expenses', roleGuard('admin', 'superadmin'), ctrl.createExpense);
router.patch('/expenses/:id', roleGuard('admin', 'superadmin'), ctrl.updateExpense);
router.delete('/expenses/:id', roleGuard('admin', 'superadmin'), ctrl.deleteExpense);

export default router;
