import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './whatsapp.controller.js';

const router = Router();
router.use(verifyToken);

// Sin roleGuard a proposito: esta pantalla es de las gestoras. El recorte va en
// el controlador, que a un gestor le fuerza su propio responsableId y solo le
// enseña las plantillas compartidas mas las suyas.
router.get('/templates', ctrl.listTemplates);
router.post('/templates', ctrl.createTemplate);
router.patch('/templates/:id', ctrl.updateTemplate);
router.delete('/templates/:id', ctrl.deleteTemplate);

router.get('/cola', ctrl.cola);
router.get('/sala', ctrl.sala);

// El panel del equipo. El recorte va en el controlador —solo admin— igual que
// el resto del modulo.
router.get('/equipo', ctrl.equipo);
router.post('/equipo/:userId/abrir', ctrl.abrirSala);
router.post('/equipo/:userId/latido', ctrl.latido);

export default router;
