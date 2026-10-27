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
router.get('/curso/:productId/brochure', puede('tutores.mis_cursos', 'tutores.gestionar'), ctrl.brochureDelCurso);

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

export default router;
