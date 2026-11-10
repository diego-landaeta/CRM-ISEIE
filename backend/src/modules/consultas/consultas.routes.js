import { Router } from 'express';
import multer from 'multer';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './consultas.controller.js';

// Los adjuntos de la respuesta: PDF, imágenes y los documentos de siempre, hasta
// 10 MB cada uno y 5 por respuesta (#188: «tamaño máximo y tipos permitidos»).
const TIPOS = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);
const subir = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (_req, f, cb) => (TIPOS.has(f.mimetype)
    ? cb(null, true)
    : cb(new AppError(`«${f.originalname}»: solo PDF, imágenes, Word, Excel o texto.`, 400, 'TIPO_NO_ADMITIDO'), false)),
}).array('adjuntos', 5);

function conAdjuntos(req, res, next) {
  subir(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new AppError('Un adjunto pasa de 10 MB.', 400, 'ADJUNTO_GRANDE'));
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Como mucho 5 adjuntos por respuesta.', 400, 'DEMASIADOS_ADJUNTOS'));
    }
    return next(err);
  });
}

const router = Router();
router.use(verifyToken);

// Cada ruta con su permiso (#423). Las de UNA consulta (ver, responder, cerrar,
// adjuntos, reintentar) y la bandeja (`/mias`) no piden permiso: son lo de cada
// uno, y el controlador deja a su tutor o a administración de ese campus
// (exigirVer). Lo de lo suyo O de todos (alumnos sin mensajes, métricas) entra
// con cualquiera de las dos, y el controlador mira cuál hace falta.
const administracion = puede('consultas.view');
const gestion = puede('consultas.gestionar');
const atiende = puede('consultas.atender');
const suyasOTodas = puede('consultas.atender', 'consultas.view');

// Las concretas antes que /:id.
router.get('/mias', ctrl.mias);
router.post('/leer-ahora', gestion, ctrl.leerAhora);
router.get('/adjuntos/:id', ctrl.adjunto);
router.post('/mensajes/:mensajeId/reintentar', ctrl.reintentar);
// El token del tutor en cada campus: administración o quien gestiona colaboraciones.
router.get('/tutores/:tutorId/tokens', puede('consultas.gestionar', 'tutores.gestionar'), ctrl.tokensDelTutor);
router.put('/tutores/:tutorId/token', puede('consultas.gestionar', 'tutores.gestionar'), ctrl.guardarToken);
// Fase 3 (#189).
router.get('/alumnos-sin-mensajes', suyasOTodas, ctrl.alumnosSinMensajes);
router.post('/alumnos/:id/escribir', ctrl.escribirAlAlumno);
router.get('/carga', atiende, ctrl.miCarga);
router.post('/carga', atiende, ctrl.guardarMiCarga);
router.get('/tutores-panel', administracion, ctrl.panelDeTutores);
router.get('/campus-sin-tutor', administracion, ctrl.campusSinTutor);
router.post('/sincronizar-alumnos', gestion, ctrl.sincronizarAlumnosAhora);
router.get('/metricas', suyasOTodas, ctrl.verMetricas);

router.get('/', administracion, ctrl.panel);
router.get('/:id', ctrl.ver);
router.post('/:id/responder', conAdjuntos, ctrl.responder);
router.post('/:id/cerrar', ctrl.cerrar);
router.get('/:id/tutores', gestion, ctrl.tutoresPosibles);
router.post('/:id/reasignar', gestion, ctrl.reasignar);

// El enlace del adjunto que recibe el alumno en el campus: sin sesión, con su
// token largo y su caducidad. Va aparte porque el router de arriba pide sesión.
export const publico = Router();
publico.get('/:token', ctrl.adjuntoPublico);

export default router;
