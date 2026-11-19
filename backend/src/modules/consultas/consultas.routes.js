import { Router } from 'express';
import multer from 'multer';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { AppError } from '../../shared/utils/AppError.js';
import { pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
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

/*
  EL PLUGIN DEL CRM EN EL MOODLE DE CADA CAMPUS (#679), SOLO EN PRUEBAS.

  Su estado, el código de conexión y apagarlo. Dar un código es dar la conexión
  entera del campus (token incluido), y con el plugin conectado el CRM escribe en
  el Moodle: con NODE_ENV=production no se montan —responden 404— salvo en
  /staging o con PLUGIN_MOODLE_EN_PRODUCCION=1. Se decide al cargar, como en
  `app.js` y en ia.routes.js.
*/
if (pluginMoodleActivo()) {
  router.get('/campus/:projectId/plugin', gestion, ctrl.estadoDelPlugin);
  // El código da la conexión entera del campus (token incluido): lo genera quien edita integraciones.
  router.post('/campus/:projectId/plugin/codigo', gestion, puede('integrations.edit'), ctrl.codigoDeConexion);
  router.delete('/campus/:projectId/plugin', gestion, ctrl.desactivarPlugin);
}

// Un :id que no es un número no es ninguna consulta: 404, no el 500 de Postgres
// (22P02) que daba, por ejemplo, /api/consultas/tutores (#188).
function idDeConsulta(req, _res, next) {
  const { id } = req.params;
  if (/^\d{1,10}$/.test(id) && Number(id) > 0 && Number(id) <= 2147483647) return next();
  return next(new AppError('Consulta no encontrada', 404, 'NOT_FOUND'));
}
// Lo mismo con el :rid de una respuesta guardada.
function idDeRespuesta(req, _res, next) {
  const { rid } = req.params;
  if (/^\d{1,10}$/.test(rid) && Number(rid) > 0 && Number(rid) <= 2147483647) return next();
  return next(new AppError('Respuesta no encontrada', 404, 'NOT_FOUND'));
}

// Respuestas guardadas (#679): las suyas y las de sus campus. Antes que /:id.
router.get('/respuestas', ctrl.respuestas);
router.post('/respuestas', ctrl.crearRespuesta);
router.post('/respuestas/importar', ctrl.importarRespuestas);
router.put('/respuestas/:rid', idDeRespuesta, ctrl.cambiarRespuesta);
router.delete('/respuestas/:rid', idDeRespuesta, ctrl.borrarRespuesta);

router.get('/', administracion, ctrl.panel);
router.get('/:id', idDeConsulta, ctrl.ver);
router.get('/:id/contexto', idDeConsulta, ctrl.contexto);
router.post('/:id/responder', idDeConsulta, conAdjuntos, ctrl.responder);
router.post('/:id/cerrar', idDeConsulta, ctrl.cerrar);
// Nota interna (#679): para el relevo y coordinación; el alumno no la ve.
router.post('/:id/notas', idDeConsulta, ctrl.anotar);
router.get('/:id/tutores', idDeConsulta, gestion, ctrl.tutoresPosibles);
router.post('/:id/reasignar', idDeConsulta, gestion, ctrl.reasignar);

// El enlace del adjunto que recibe el alumno en el campus: sin sesión, con su
// token largo y su caducidad. Va aparte porque el router de arriba pide sesión.
export const publico = Router();
publico.get('/:token', ctrl.adjuntoPublico);

export default router;
