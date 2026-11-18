import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './informe-mensual.controller.js';

const router = Router();

// Sin usuario: el enlace firmado del correo a la gestoría es la llave. Pocos
// intentos por IP, como la descarga de la copia diaria.
const limite = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Prueba de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});
router.get('/descarga/:issuerId/:periodo', limite, ctrl.descargarConEnlace);

router.use(verifyToken);
// El informe del mes por equipo y comercial (pantalla y Excel) y el ZIP de
// facturas de una empresa (#772). Se bajan a mano aunque el envío esté apagado.
router.get('/', puede('reports.informe_mensual'), ctrl.informe);
router.get('/excel', puede('reports.informe_mensual'), ctrl.excel);
router.get('/zip', puede('reports.informe_mensual'), ctrl.zip);

export default router;
