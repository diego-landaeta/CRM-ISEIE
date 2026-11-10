import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './actividad.controller.js';

const router = Router();
router.use(verifyToken);

// Sin roleGuard a propósito: es la vista de las GESTORAS (el Registro, #111, es
// solo para admin). El controlador recorta cada una a lo suyo.
router.get('/', ctrl.listar);

export default router;
