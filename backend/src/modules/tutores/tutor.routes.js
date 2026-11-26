import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { pluginMoodleActivo, redactorasMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import * as ctrl from './tutor.controller.js';

const router = Router();
router.use(verifyToken);

// Sin roleGuard: el recorte va en el controlador porque no es por rol a secas.
// Gestionar colaboraciones lo puede hacer un admin O quien tenga la casilla
// `gestor_colaboraciones`, y un tutor puede ver SUS cosas y solo las suyas.
// Un roleGuard aqui no sabria distinguir esos tres casos.
//
// Las rutas concretas van ANTES que /:id, o Express intentaria interpretar
// «colaboraciones» y «ajustes» como identificadores de tutor.
router.get('/colaboraciones', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.colaboraciones);
router.post('/colaboraciones', puede('tutores.gestionar'), ctrl.crearColaboracion);
router.patch('/colaboraciones/:id', puede('tutores.gestionar'), ctrl.editarColaboracion);
router.delete('/colaboraciones/:id', puede('tutores.gestionar'), ctrl.borrarColaboracion);

router.get('/ajustes', puede('tutores.gestionar'), ctrl.ajustes);
router.patch('/ajustes', puede('tutores.ajustes'), ctrl.guardarAjustes);

router.get('/simulacion', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.simulacion);

// El dinero. Calcular y consultar lo puede hacer quien gestiona; liquidar y
// revertir, solo un administrador — el recorte esta en el controlador.
router.post('/comisiones/calcular', puede('tutores.gestionar'), ctrl.calcular);
router.get('/comisiones/resumen', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.resumenComisiones);
router.get('/comisiones', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.listarComisiones);
router.post('/comisiones/liquidar', puede('tutores.liquidar'), ctrl.liquidar);
router.patch('/comisiones/:id/estado', puede('tutores.gestionar'), ctrl.cambiarEstadoComision);
router.post('/comisiones/:id/revertir', puede('tutores.liquidar'), ctrl.revertirComision);
router.get('/formaciones-sin-tutor', puede('tutores.gestionar'), ctrl.formacionesSinTutor);
router.get('/pagos-sin-formacion', puede('tutores.gestionar'), ctrl.pagosSinFormacion);
router.put('/formaciones/:productId/busqueda', puede('tutores.gestionar'), ctrl.marcarBusqueda);
router.get('/anuncios', puede('tutores.gestionar'), ctrl.anunciosDeTutores);

// La ficha del curso que imparte, sin poder tocarla.
router.get('/curso/:productId', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.cursoDetalle);
// «Mi campus» (#408, gemela de CRM#681): sus cursos de Moodle con alumnos, dudas y entregas
// por corregir, y lo que tiene por desarrollar. Solo lee Moodle; solo lo suyo.
// Con «Mi campus de administración» también: quien revisa el campus y además da clase con su
// cuenta enlazada ve y corrige lo suyo como cualquier tutora. Lo de dentro solo es SUYO
// (tutor_campus de quien pide y, para corregir, profesora del curso en Moodle).
const MIS_CURSOS = ['tutores.mis_cursos', 'tutores.campus_administracion'];
router.get('/mi-campus', puede(...MIS_CURSOS), ctrl.miCampus);
// «Mi campus» de administración (gemela de CRM, 25/11): todo el campus con el token del campus, solo lectura.
router.get('/mi-campus/administracion', puede('tutores.campus_administracion'), ctrl.campusAdministracion);
router.get('/mi-campus/administracion/cursos/:projectId/:cursoId', puede('tutores.campus_administracion'), ctrl.cursoAdministracion);
// La redactora ve lo suyo (CRM#1026): su cuenta y su rol en los cursos que redacta, con el
// id del token (sin `:id`: no puede pedir el de otra). Antes que `/:id/...`. Aún sin aprobar.
if (redactorasMoodleActivo()) {
  router.get('/mi-campus/redaccion-moodle', puede('tutores.mis_cursos'), ctrl.miRedaccionMoodle);
}
// Corregir desde el CRM (#408, gemela de CRM#681): la tarea con sus entregas, un archivo entregado y la nota.
router.get('/mi-campus/tareas/:projectId/:cursoId/:tareaId/archivo', puede(...MIS_CURSOS), ctrl.archivoEntregado);
router.get('/mi-campus/tareas/:projectId/:cursoId/:tareaId', puede(...MIS_CURSOS), ctrl.verTarea);
// El curso entero, como en Moodle: temas y todas sus actividades.
router.get('/mi-campus/cursos/:projectId/:cursoId', puede(...MIS_CURSOS), ctrl.verCurso);
// Poner la nota ESCRIBE en el Moodle del alumno (por el plugin, `local_crm_calificar`):
// con NODE_ENV=production no se monta —404— salvo en /staging o con
// PLUGIN_MOODLE_EN_PRODUCCION=1, como las rutas del plugin en consultas.routes.js.
// Leer (Mi campus, la tarea, el curso, los archivos) sí va siempre: no cambia nada.
if (pluginMoodleActivo()) {
  router.post('/mi-campus/tareas/:projectId/:cursoId/:tareaId/calificar', puede(...MIS_CURSOS), ctrl.calificar);
}
router.get('/curso/:productId/brochure', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.brochureDelCurso);

// El buscador (Ctrl K, #591). Antes que `/:id`, o «buscar» se leería como un id.
router.get('/buscar', puede('tutores.gestionar'), ctrl.buscar);
router.get('/', puede('tutores.gestionar'), ctrl.listar);
router.post('/', puede('tutores.gestionar'), ctrl.alta);
router.get('/:id', ctrl.ficha);
router.patch('/:id/perfil', ctrl.guardarPerfil);
// «Cobra desde»: la fecha de inicio de todas sus colaboraciones activas.
router.patch('/:id/cobra-desde', puede('tutores.gestionar'), ctrl.cambiarCobraDesde);
// Quien lleva las colaboraciones tambien resuelve las claves y las bajas.
router.post('/:id/contrasena', puede('tutores.contrasena'), ctrl.cambiarContrasena);
router.post('/:id/reactivar', puede('tutores.gestionar'), ctrl.reactivarTutor);
router.delete('/:id', puede('tutores.gestionar'), ctrl.retirarTutor);

// Consultas de alumnos, fase 1 (#187): en qué campus atiende, por campus o por
// empresa entera, si está matriculado en cada uno y «No disponible».
router.get('/:id/campus', ctrl.campusDelTutor);
router.post('/:id/campus', puede('tutores.gestionar'), ctrl.asignarCampus);
router.post('/:id/campus/comprobar', puede('tutores.gestionar'), ctrl.comprobarCampus);
// Su cuenta de Moodle, campus a campus y solo en los de tu empresa (#679, revisión de la #689).
// Su cuenta cambió de verdad: olvidar la vinculada y buscarla de nuevo.
router.post('/:id/campus/:projectId/desvincular', puede('tutores.gestionar'), ctrl.desvincularCuenta);
// Su correo del CRM no es el de Moodle: buscar su cuenta y vincularla a mano.
router.get('/:id/campus/:projectId/buscar-cuenta', puede('tutores.gestionar'), ctrl.buscarCuentaMoodle);
router.post('/:id/campus/:projectId/vincular', puede('tutores.gestionar'), ctrl.vincularCuentaMoodle);
// La redactora en Moodle (CRM#1026): su cuenta y su rol en los cursos que redacta. Solo LEE,
// pero aún sin aprobar: en producción, 404 salvo REDACTORAS_MOODLE_EN_PRODUCCION=1.
if (redactorasMoodleActivo()) {
  router.get('/:id/redaccion-moodle', puede('tutores.gestionar'), ctrl.redaccionMoodle);
}
router.post('/:id/empresas', puede('tutores.gestionar'), ctrl.asignarEmpresa);
router.delete('/:id/empresas/:issuerId', puede('tutores.gestionar'), ctrl.quitarEmpresa);
router.patch('/:id/disponible', puede('tutores.gestionar'), ctrl.cambiarDisponible);

export default router;
