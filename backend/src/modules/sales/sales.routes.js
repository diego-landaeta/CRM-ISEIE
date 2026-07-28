import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as salesController from './sales.controller.js';

const router = Router();
router.use(verifyToken);

// POST /api/sales — registrar venta (cualquier rol autenticado: gestor, admin, superadmin).
router.post('/', roleGuard('gestor', 'admin', 'superadmin'), salesController.create);

// GET /api/sales/top-products — ranking de programas más vendidos para dashboards.
router.get('/resumen', salesController.resumenVentas);
router.get('/por-asesora', salesController.ventasPorAsesora);
router.get('/por-cliente', salesController.ventasPorCliente);
router.get('/top-products', salesController.topProducts);

// GET /api/sales/gestores-stats — ventas + metas por gestor del periodo
router.get('/gestores-stats', salesController.gestoresStats);

// GET /api/sales/my-stats — el gestor consulta sus ventas+meta del periodo
router.get('/my-stats', salesController.myStats);

// POST /api/sales/goals — UPSERT meta (gestor solo la suya, admin cualquiera)
router.post('/goals', salesController.setGoal);

// DELETE /api/sales/goals/:id
router.delete('/goals/:id', salesController.deleteGoal);

export default router;
