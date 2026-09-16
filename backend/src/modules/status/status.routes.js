import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './status.controller.js';

const router = Router();

// Endpoints públicos — sin auth
router.get('/', ctrl.getStatus);
router.get('/incidents', ctrl.getIncidents);

// Endpoints protegidos — solo soporte/admin
router.use(verifyToken);
router.post('/incidents', roleGuard('admin', 'superadmin'), ctrl.createIncident);
router.put('/incidents/:id', roleGuard('admin', 'superadmin'), ctrl.updateIncident);
router.put('/components/:slug', roleGuard('admin', 'superadmin'), ctrl.updateComponent);
router.get('/errors', roleGuard('admin', 'superadmin'), ctrl.getErrors);
// Como esta cada pieza ahora mismo (#26). Detras del candado aunque no lleve
// datos de clientes: dice que integraciones hay y cuando fallo cada una, y eso
// es un mapa del sistema que no tiene por que ver cualquiera.
router.get('/piezas', roleGuard('admin', 'superadmin'), ctrl.getPiezas);
// Los correos que salieron y los que no. Mismo candado: aqui se ven
// direcciones de clientes.
router.get('/correos', roleGuard('admin', 'superadmin'), ctrl.getCorreos);

export default router;
