import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './moodle.controller.js';

const router = Router();

// Permisos del catalogo (#423): `moodle.view` (administracion) y `moodle.conectar` (solo super admin:
// conectar un Moodle es guardar una credencial, como en Configuracion → Claves).
const verPanel = puede('moodle.view');
const conectarMoodle = puede('moodle.conectar');

router.use(verifyToken);

router.get('/campus', verPanel, ctrl.campus);
router.get('/cursos', verPanel, ctrl.cursos);
router.get('/campus/:id/revision', verPanel, ctrl.revision);
router.get('/categorias', verPanel, ctrl.categorias);
router.get('/cursos/:id/alumnos', verPanel, ctrl.alumnos);
router.get('/cursos/:id/estructura', verPanel, ctrl.estructura);
router.get('/cursos/:id/recursos', verPanel, ctrl.recursos);

router.post('/campus/:id/conexion', conectarMoodle, ctrl.conectar);
router.delete('/campus/:id/conexion', conectarMoodle, ctrl.desconectar);

export default router;
