import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './feedback.controller.js';
import { servir as servirCabecera, servirInsignia } from './cabecera.js';

// Con sesión: el panel, su lista y el correo de cada ficha.
const router = Router();
router.use(verifyToken);
router.get('/panel', ctrl.panel);
router.get('/lista', ctrl.lista);
router.get('/lead/:leadId', ctrl.deUnLead);
router.post('/lead/:leadId/enviar', ctrl.enviarLoRevisado);
router.post('/lead/:leadId/no-enviar', ctrl.noEnviar);

// Sin sesión: la encuesta. Con un límite por IP: el enlace no pide contraseña,
// así que es lo que impide probar tokens a ciegas.
const publicRouter = Router();
// La cabecera de la marca de los correos, ANTES del límite: la piden los
// proxies de imágenes de Gmail y compañía, muchos correos desde pocas IP. Está
// en memoria y no enseña nada que no esté ya en la web de la marca.
// SIN «.png» en la dirección: el nginx de ISEIE sirve como fichero estático
// todo lo que acaba en .png y nunca llegaba a la API. El cliente de correo se
// guía por el Content-Type. La de «.png» se queda por los correos ya enviados.
publicRouter.get('/cabecera/:projectId', servirCabecera);
publicRouter.get('/cabecera/:projectId.png', servirCabecera);
// El logo de cada empresa en los resúmenes al equipo, dibujado igual.
publicRouter.get('/insignia/:projectId', servirInsignia);
publicRouter.use(rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
publicRouter.get('/:token', ctrl.encuesta);
publicRouter.post('/:token', ctrl.responder);

export default router;
export { publicRouter };
