import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { uploadDoc } from '../../shared/middleware/upload.js';
import * as ctrl from './accounting.controller.js';

const router = Router();

router.use(verifyToken);

// Dashboard accounting (admin y superadmin, NO gestor)
router.get('/dashboard', roleGuard('admin', 'superadmin'), ctrl.dashboard);

// Cuentas por cobrar (admin, superadmin y gestor — la gestora solo ve las suyas)
router.get('/receivable', roleGuard('admin', 'superadmin', 'soporte', 'gestor'), ctrl.receivable);

// Expenses CRUD (admin y superadmin)
router.get('/expenses', roleGuard('admin', 'superadmin'), ctrl.listExpenses);

// Upload + download de comprobante (PDF/JPG/PNG/WEBP, máx 10MB).
// Upload va ANTES de '/expenses/:id' para que no se interprete como un id.
router.post('/expenses/upload-comprobante', roleGuard('admin', 'superadmin'), uploadDoc, ctrl.uploadComprobante);
router.get('/expenses/comprobante/:key', roleGuard('admin', 'superadmin'), ctrl.downloadComprobante);

router.get('/expenses/:id', roleGuard('admin', 'superadmin'), ctrl.getExpense);
router.post('/expenses', roleGuard('admin', 'superadmin'), ctrl.createExpense);
router.patch('/expenses/:id', roleGuard('admin', 'superadmin'), ctrl.updateExpense);
router.delete('/expenses/:id', roleGuard('admin', 'superadmin'), ctrl.deleteExpense);

export default router;
