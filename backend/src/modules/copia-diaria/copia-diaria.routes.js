import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from './copia-diaria.controller.js';

const router = Router();

// Sin usuario: el enlace firmado del correo es la llave. Pocos intentos por IP,
// que una firma de 43 caracteres no se adivina, pero tampoco se deja probar.
const limite = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Prueba de nuevo en 15 minutos.', code: 'RATE_LIMITED' },
});

router.get('/descarga/:fichero', limite, ctrl.descargar);

export default router;
