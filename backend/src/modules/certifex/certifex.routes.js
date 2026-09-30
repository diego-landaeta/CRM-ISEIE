import { Router } from 'express';
import { verifyToken, roleGuard, soloRoles } from '../../shared/middleware/auth.js';
import * as ctrl from './certifex.controller.js';
import * as emisiones from './certifex.emisiones.js';

const router = Router();

// La unica ruta sin sesion: la entrega desde el servidor de Certifex. La protege el
// secreto compartido (CERTIFEX_WEBHOOK_SECRETO), no una sesion de nadie. Va antes del
// `verifyToken` a proposito, y es la unica que debe ir aqui arriba.
router.post('/consultas', ctrl.recibir);

router.use(verifyToken);
// Los mismos roles que ven la campana de administracion: son quienes reciben el aviso.
router.use(roleGuard('admin', 'superadmin', 'soporte'));

router.get('/consultas', ctrl.listar);
router.patch('/consultas/:id', ctrl.actualizar);

// Emisiones: aprobar, rechazar y emitir titulos en Certifex. Solo administracion: es
// decidir quien recibe un titulo que no se puede borrar. Soporte ve las consultas, no esto.
// `soloRoles` y no `roleGuard`: roleGuard deja pasar a soporte antes de mirar la lista,
// y con el soporte habria podido aprobar y emitir titulos.
const soloAdmin = soloRoles('admin', 'superadmin');
router.get('/emisiones/estado', soloAdmin, emisiones.estado);
router.get('/emisiones/centros', soloAdmin, emisiones.centros);
router.get('/emisiones/cursos', soloAdmin, emisiones.cursos);
router.get('/emisiones', soloAdmin, emisiones.listar);
router.post('/emisiones/decisiones', soloAdmin, emisiones.decidir);
router.post('/emisiones/emitir', soloAdmin, emisiones.emitir);
router.get('/emisiones/diploma/:nexp', soloAdmin, emisiones.diploma);
router.get('/emisiones/logo', soloAdmin, emisiones.logo);

export default router;
