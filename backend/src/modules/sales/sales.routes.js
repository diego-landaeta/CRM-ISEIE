import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as salesController from './sales.controller.js';

const router = Router();
router.use(verifyToken);

// POST /api/sales — registrar venta (cualquier rol autenticado: gestor, admin, superadmin).
router.post('/', puede('ventas.registrar'), salesController.create);

// GET /api/sales/top-products — ranking de programas más vendidos para dashboards.
// Estos tres exponen las cifras del proyecto entero y el desglose por asesora:
// solo admin. Antes bastaba con estar autenticado, asi que una gestora podia
// pedirlos por API aunque la pantalla se los escondiera.
router.get('/resumen', puede('ventas.view_equipo'), salesController.resumenVentas);
router.get('/por-asesora', puede('ventas.view_equipo'), salesController.ventasPorAsesora);
// Sin roleGuard: filtrosDeQuery ya recorta a la gestora a sus propios clientes.
router.get('/por-cliente', puede('ventas.view'), salesController.ventasPorCliente);
// Este se queda abierto: lo pinta el dashboard de todos los roles.
router.get('/top-products', puede('ventas.view'), salesController.topProducts);
// Lo facturado del Dashboard (#224): bloque del equipo y «Productos vendidos».
// Abierto como top-products: el controlador recorta a la gestora a lo suyo.
router.get('/facturado', puede('ventas.view'), salesController.facturado);

// GET /api/sales/gestores-stats — ventas + metas por gestor del periodo.
// Solo admin: son las cifras y las metas de TODO el equipo.
router.get('/gestores-stats', puede('ventas.view_equipo'), salesController.gestoresStats);
// De que se compone lo vendido: por tipo de formacion y por tipo de cobro.
// El desglose y los paises se quedan abiertos a proposito: el controlador ya
// recorta a la gestora a lo suyo, y son su vista de «mi trabajo».
router.get('/desglose', puede('ventas.view'), salesController.desglose);
router.get('/paises', puede('ventas.view'), salesController.paises);
// Serie con comparacion e historial. SIN roleGuard a proposito: una gestora
// tiene que poder ver la suya, y el controlador ya la recorta a lo suyo.
router.get('/serie', puede('ventas.view'), salesController.serieVentas);

// GET /api/sales/my-stats — el gestor consulta sus ventas+meta del periodo
router.get('/my-stats', puede('ventas.view'), salesController.myStats);

// POST /api/sales/goals — UPSERT meta (gestor solo la suya, admin cualquiera)
router.post('/goals', puede('ventas.metas'), salesController.setGoal);

// DELETE /api/sales/goals/:id
router.delete('/goals/:id', puede('ventas.metas'), salesController.deleteGoal);

export default router;
