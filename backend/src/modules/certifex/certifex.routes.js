import { Router } from 'express';
import { verifyToken, roleGuard, soloRoles } from '../../shared/middleware/auth.js';
import * as ctrl from './certifex.controller.js';
import * as emisiones from './certifex.emisiones.js';
import * as diplomas from './certifex.diplomas.js';

const router = Router();

// Las unicas rutas sin sesion: las entregas desde el servidor de Certifex (consultas y
// solicitudes de diploma). Las protege el secreto compartido (CERTIFEX_WEBHOOK_SECRETO),
// no una sesion de nadie. Van antes del `verifyToken` a proposito, y son las unicas que
// deben ir aqui arriba.
router.post('/consultas', ctrl.recibir);
// Lo mismo para las solicitudes de diploma que el alumno hace desde Moodle (#272).
router.post('/solicitudes', ctrl.recibirSolicitud);
// Y el aviso de que Moodle da una formacion por terminada sin que el alumno lo haya pedido.
router.post('/completados', ctrl.recibirCompletado);

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

// Diplomas (#272): las solicitudes desde Moodle y los diplomas emitidos. Tambien solo
// administracion: aprobar, rechazar, emitir, aprobar el aviso, revocar y corregir. Y
// ademas, cada admin solo sobre los campus de sus proyectos (certifex.alcance.js): eso
// lo mira cada controlador, porque depende de la matricula o del diploma.
// Ver el PDF reutiliza `/emisiones/diploma/:nexp`.
router.get('/diplomas/resumen', soloAdmin, diplomas.resumen);
router.get('/diplomas/solicitudes', soloAdmin, diplomas.solicitudes);
router.get('/diplomas/por-avisar', soloAdmin, diplomas.porAvisar);
// Solo consulta: Moodle los da por terminados y aun no han pedido el diploma.
router.get('/diplomas/terminados', soloAdmin, diplomas.terminados);
router.post('/diplomas/aprobar-emitir', soloAdmin, diplomas.aprobarEmitir);
router.post('/diplomas/emitir', soloAdmin, diplomas.emitir);
router.post('/diplomas/rechazar', soloAdmin, diplomas.rechazar);
router.post('/diplomas/avisos', soloAdmin, diplomas.avisos);
router.post('/diplomas/avisos-rechazo', soloAdmin, diplomas.avisosRechazo);
router.post('/diplomas/revocar', soloAdmin, diplomas.revocar);
router.post('/diplomas/corregir', soloAdmin, diplomas.corregir);
// Revisar antes de aprobar: nombre (en Certifex), correo del CRM, formacion y programa.
router.post('/diplomas/editar', soloAdmin, diplomas.editar);
// «Nuevo diploma»: desde cero, eligiendo cliente y formación (19/10).
router.post('/diplomas/nuevo', soloAdmin, diplomas.nuevo);
router.get('/diplomas/formaciones', soloAdmin, diplomas.formaciones);
router.post('/diplomas/formaciones/sincronizar', soloAdmin, diplomas.sincronizarFormacion);
router.get('/diplomas', soloAdmin, diplomas.diplomas);

export default router;
