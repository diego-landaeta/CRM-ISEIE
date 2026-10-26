import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './status.controller.js';

const router = Router();

// Endpoints públicos — sin auth
router.get('/', ctrl.getStatus);
router.get('/incidents', ctrl.getIncidents);

// Endpoints protegidos — solo soporte/admin
router.use(verifyToken);
router.post('/incidents', puede('status.edit'), ctrl.createIncident);
router.put('/incidents/:id', puede('status.edit'), ctrl.updateIncident);
router.put('/components/:slug', puede('status.edit'), ctrl.updateComponent);
router.get('/errors', puede('status.view'), ctrl.getErrors);
// Como esta cada pieza ahora mismo (#26). Detras del candado aunque no lleve
// datos de clientes: dice que integraciones hay y cuando fallo cada una, y eso
// es un mapa del sistema que no tiene por que ver cualquiera.
router.get('/piezas', puede('status.view'), ctrl.getPiezas);
// Los correos que salieron y los que no. Mismo candado: aqui se ven
// direcciones de clientes.
router.get('/correos', puede('status.view'), ctrl.getCorreos);

export default router;
