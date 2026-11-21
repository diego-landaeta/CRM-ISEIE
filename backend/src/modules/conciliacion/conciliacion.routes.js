import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './conciliacion.controller.js';

// Finanzas › Conciliación › Facturas y cobros (CRM#905). El campus y el
// alcance los recorta el controlador (`proyectosDelAmbito`, administración).
const router = Router();

router.use(verifyToken);

router.get('/facturas-cobros',                   puede('facturas.gestionar'), ctrl.listar);
router.post('/facturas-cobros/enlazar',          puede('facturas.gestionar'), ctrl.enlazar);
router.post('/facturas-cobros/enlazar-seguras',  puede('facturas.gestionar'), ctrl.enlazarSeguras);

export default router;
