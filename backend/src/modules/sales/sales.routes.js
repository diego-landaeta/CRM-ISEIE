import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as salesController from './sales.controller.js';

const router = Router();
router.use(verifyToken);

// POST /api/sales — registrar venta (cualquier rol autenticado: gestor, admin, superadmin).
router.post('/', roleGuard('gestor', 'admin', 'superadmin'), salesController.create);

// GET /api/sales/top-products — ranking de programas más vendidos para dashboards.
// Estos tres exponen las cifras del proyecto entero y el desglose por asesora:
// solo admin. Antes bastaba con estar autenticado, asi que una gestora podia
// pedirlos por API aunque la pantalla se los escondiera.
router.get('/resumen', roleGuard('admin', 'superadmin'), salesController.resumenVentas);
router.get('/por-asesora', roleGuard('admin', 'superadmin'), salesController.ventasPorAsesora);
router.get('/por-cliente', roleGuard('admin', 'superadmin'), salesController.ventasPorCliente);
// Este se queda abierto: lo pinta el dashboard de todos los roles.
router.get('/top-products', salesController.topProducts);

// GET /api/sales/gestores-stats — ventas + metas por gestor del periodo.
// Solo admin: son las cifras y las metas de TODO el equipo.
router.get('/gestores-stats', roleGuard('admin', 'superadmin'), salesController.gestoresStats);

// GET /api/sales/my-stats — el gestor consulta sus ventas+meta del periodo
router.get('/my-stats', salesController.myStats);

// POST /api/sales/goals — UPSERT meta (gestor solo la suya, admin cualquiera)
router.post('/goals', salesController.setGoal);

// DELETE /api/sales/goals/:id
router.delete('/goals/:id', salesController.deleteGoal);

export default router;
