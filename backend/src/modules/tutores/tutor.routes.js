import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
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
router.get('/mi-campus', puede('tutores.mis_cursos'), ctrl.miCampus);
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
router.post('/:id/empresas', puede('tutores.gestionar'), ctrl.asignarEmpresa);
router.delete('/:id/empresas/:issuerId', puede('tutores.gestionar'), ctrl.quitarEmpresa);
router.patch('/:id/disponible', puede('tutores.gestionar'), ctrl.cambiarDisponible);

export default router;
