import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './correos.controller.js';
import * as buzones from './buzones.controller.js';

const router = Router();
router.use(verifyToken);

// La Bandeja de correos (CRM-ISEIE#701, gemela de CRM#146 y CRM#1032): lo que
// LLEGA a los buzones conectados. Solo leer: el envío sigue por Brevo.
// Con permiso del catálogo y recortado a los campus de cada uno: enseña el
// TEXTO de correos de personas, que no escribimos nosotros.

router.get('/', puede('correos.view'), ctrl.listar);
router.get('/recuento', puede('correos.view'), ctrl.recuento);
// Antes de `/:id`, o «sincronizar» se leeria como el id de un correo.
router.post('/sincronizar', puede('correos.sincronizar'), ctrl.sincronizar);

// Los buzones (CRM#1032). Verlos —nombre, dirección, campus— basta con ver la
// Bandeja: es lo que se elige arriba. Conectarlos, probarlos y quitarlos pide
// `correos.buzones`. Las credenciales no salen por ninguna de estas rutas.
// También antes de `/:id`.
router.get('/buzones', puede('correos.view'), buzones.listar);
router.post('/buzones', puede('correos.buzones'), buzones.crear);
router.post('/buzones/probar', puede('correos.buzones'), buzones.probar);
router.patch('/buzones/:id', puede('correos.buzones'), buzones.cambiar);
router.delete('/buzones/:id', puede('correos.buzones'), buzones.quitar);
router.post('/buzones/:id/probar', puede('correos.buzones'), buzones.probar);
// Además pide `facturas.configurar`, que se mira dentro: cambia una empresa.
router.post('/buzones/:id/correo-de-empresa', puede('correos.buzones'), buzones.usarComoCorreoDeEmpresa);

router.get('/:id', puede('correos.view'), ctrl.uno);

export default router;
