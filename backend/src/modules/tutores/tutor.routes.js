import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
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
router.get('/colaboraciones', ctrl.colaboraciones);
router.post('/colaboraciones', ctrl.crearColaboracion);
router.patch('/colaboraciones/:id', ctrl.editarColaboracion);
router.delete('/colaboraciones/:id', ctrl.borrarColaboracion);

router.get('/ajustes', ctrl.ajustes);
router.patch('/ajustes', ctrl.guardarAjustes);

router.get('/simulacion', ctrl.simulacion);

// El dinero. Calcular y consultar lo puede hacer quien gestiona; liquidar y
// revertir, solo un administrador — el recorte esta en el controlador.
router.post('/comisiones/calcular', ctrl.calcular);
router.get('/comisiones/resumen', ctrl.resumenComisiones);
router.get('/comisiones', ctrl.listarComisiones);
router.post('/comisiones/liquidar', ctrl.liquidar);
router.post('/comisiones/:id/revertir', ctrl.revertirComision);
router.get('/pagos-sin-formacion', ctrl.pagosSinFormacion);

router.get('/', ctrl.listar);
router.post('/', ctrl.alta);
router.get('/:id', ctrl.ficha);
router.patch('/:id/perfil', ctrl.guardarPerfil);

export default router;
