import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './registro.controller.js';

const router = Router();

router.use(verifyToken);

// Admin y superadmin, y no mas abajo.
//
// El ticket dice «general — lo que le interesa a quien opera», y quien opera
// aqui es quien lleva el sistema. Un gestor solo ve sus proyectos y sus leads
// (es la regla del CRM), y este registro cruza TODAS las fichas y a TODOS los
// compañeros: quien cambio que, quien entro, quien miro una credencial. Dejarlo
// abierto seria saltarse por la puerta de atras el limite que el resto del CRM
// cumple por delante.

router.get('/', puede('registro.view'), ctrl.listar);
router.get('/fuentes', puede('registro.view'), ctrl.fuentes);
router.get('/csv', puede('registro.view'), ctrl.csv);

export default router;
