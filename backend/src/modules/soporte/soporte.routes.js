import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { uploadDoc } from '../../shared/middleware/upload.js';
import * as ctrl from './soporte.controller.js';

const router = Router();

// TODO detras de la sesion, sin excepciones — incluidos los adjuntos.
//
// En Matriculas la ruta de documentos se dejo fuera de `verifyToken` «porque
// la URL ya es no-guessable», y la URL resulto ser un entero correlativo: hoy
// se descargan DNI escaneados sin credencial. Aqui no hay ninguna ruta por
// encima de esta linea, y no debe haberla.
router.use(verifyToken);

// Cualquiera con sesion puede abrir un ticket y ver LOS SUYOS. El recorte por
// autor lo hace el controlador segun el rol.
router.get('/', ctrl.listar);

// Cada ticket nuevo dispara un aviso en la campana y, con `SOPORTE_EMAIL`, un
// correo: sin freno, una sola cuenta puede inundar la bandeja y el buzon. Tope
// POR USUARIO (no por IP: la IP la comparte toda la oficina), con el mismo
// patron que `documents.routes.js`. Va detras de `verifyToken`, asi que
// `req.user` ya existe.
const crearTicketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ticket-nuevo-${req.user?.userId || 'anon'}`,
  message: { success: false, error: 'Has abierto muchos tickets seguidos. Intentalo de nuevo en un rato.', code: 'RATE_LIMITED' },
});
router.post('/', crearTicketLimiter, ctrl.crear);

// LAS RUTAS DE PALABRA FIJA VAN ANTES QUE `/:id`.
//
// Express toma la primera que encaja, asi que con `/:id` por delante una
// peticion a `/tiempos` o a `/adjuntos/5` se leeria como el ticket con id
// «tiempos» o «adjuntos» — y el fallo no es un 404 limpio, es un NaN que
// llega a la consulta.
router.get('/tiempos', ctrl.tiempos);
router.get('/adjuntos/:adjuntoId', ctrl.descargarAdjunto);

router.get('/:id', ctrl.porId);
router.post('/:id/mensajes', ctrl.responder);
router.patch('/:id/estado', ctrl.cambiarEstado);
router.post('/:id/adjuntos', uploadDoc, ctrl.subirAdjunto);
router.delete('/:id', ctrl.borrar);

export default router;
