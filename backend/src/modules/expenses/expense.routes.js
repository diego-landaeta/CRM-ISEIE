import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadDoc } from '../../shared/middleware/upload.js';
import * as ctrl from './expense.controller.js';

const router = Router();

router.use(verifyToken);

// Egresos: admin y superadmin. El gestor no opera sobre la contabilidad.
// Lo que ve cada uno lo recorta el servicio por sus campus (#245).

router.get('/', puede('expenses.view'), ctrl.listExpenses);
// Los totales del filtro entero (no de la página). Antes de '/:id'.
router.get('/resumen', puede('expenses.view'), ctrl.resumen);

// Upload + download de comprobante (PDF/JPG/PNG/WEBP, máx 10MB).
// Van ANTES de '/:id' para que no se interpreten como un id.
router.post('/upload-comprobante', puede('expenses.create'), uploadDoc, ctrl.uploadComprobante);
router.get('/comprobante/:key', puede('expenses.view'), ctrl.downloadComprobante);

router.get('/:id', puede('expenses.view'), ctrl.getExpense);
router.post('/', puede('expenses.create'), ctrl.createExpense);
router.patch('/:id', puede('expenses.edit'), ctrl.updateExpense);
router.delete('/:id', puede('expenses.delete'), ctrl.deleteExpense);

export default router;
