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

router.get('/', ctrl.listar);
router.post('/', ctrl.alta);
router.get('/:id', ctrl.ficha);
router.patch('/:id/perfil', ctrl.guardarPerfil);

export default router;
