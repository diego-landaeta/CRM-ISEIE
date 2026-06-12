import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { uploadDoc } from '../../shared/middleware/upload.js';
import * as ctrl from './expense.controller.js';

const router = Router();

router.use(verifyToken);

// CRUD de egresos (admin y superadmin).
// El gestor no opera sobre la contabilidad operativa.
router.get('/', roleGuard('admin', 'superadmin'), ctrl.listExpenses);

// Upload + download de comprobante (PDF/JPG/PNG/WEBP, máx 10MB).
// Upload va ANTES de '/:id' para que no se interprete como un id.
router.post('/upload-comprobante', roleGuard('admin', 'superadmin'), uploadDoc, ctrl.uploadComprobante);
router.get('/comprobante/:key', roleGuard('admin', 'superadmin'), ctrl.downloadComprobante);

router.get('/:id', roleGuard('admin', 'superadmin'), ctrl.getExpense);
router.post('/', roleGuard('admin', 'superadmin'), ctrl.createExpense);
router.patch('/:id', roleGuard('admin', 'superadmin'), ctrl.updateExpense);
router.delete('/:id', roleGuard('admin', 'superadmin'), ctrl.deleteExpense);

export default router;
