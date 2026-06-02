import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as salesController from './sales.controller.js';

const router = Router();
router.use(verifyToken);

// POST /api/sales — registrar venta (cualquier rol autenticado: gestor, admin, superadmin).
router.post('/', roleGuard('gestor', 'admin', 'superadmin'), salesController.create);

export default router;
