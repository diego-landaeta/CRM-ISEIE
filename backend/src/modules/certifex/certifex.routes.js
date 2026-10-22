import { Router } from 'express';
import { verifyToken, roleGuard, soloRoles } from '../../shared/middleware/auth.js';
import { rolOPermiso } from '../../shared/middleware/permissions.js';
import { uploadImage } from '../../shared/middleware/upload.js';
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

// `soloRoles` y no `roleGuard`: roleGuard deja pasar a soporte antes de mirar la lista,
// y con el soporte habria podido aprobar y emitir titulos.
const soloAdmin = soloRoles('admin', 'superadmin');

// VER Diplomas sin ser admin (#223). Diego: «Adriana, Daniela, Yosbely, Dayana, Mireia y
// Ana deben de tener para ver los de Certifex». Ver, no tocar: admin y superadmin por su
// rol, y ademas quien tenga `diplomas.view` (Configuracion › Roles, por rol o por
// persona). Siempre acotado a sus campus: lo hace cada controlador con el alcance de
// certifex.alcance.js, que vale para cualquiera que no sea super admin.
//
// Son SOLO las lecturas que pinta la pantalla Diplomas: el estado de la conexion, sus
// campus y sus formaciones (filtros), los contadores, las cinco listas, el logo de cada
// campus y el PDF digital de un diploma (el A3 de imprenta sigue siendo de admin: lo
// mira el controlador). Van ANTES del `roleGuard` general, que no deja pasar a una
// gestora, y cada una con su guardia: lo de despues no cambia para nadie.
//
// Quien EMITE (`diplomas.emit`, abajo) tambien ve: no hace falta darle las dos claves.
const verDiplomas = rolOPermiso(['admin', 'superadmin'], 'diplomas', ['view', 'emit']);
router.get('/emisiones/estado', verDiplomas, emisiones.estado);
router.get('/emisiones/centros', verDiplomas, emisiones.centros);
router.get('/emisiones/cursos', verDiplomas, emisiones.cursos);
router.get('/emisiones/logo', verDiplomas, emisiones.logo);
// Ver el PDF de un diploma desde Diplomas (reutiliza el de Emisiones).
router.get('/emisiones/diploma/:nexp', verDiplomas, emisiones.diploma);
router.get('/diplomas/resumen', verDiplomas, diplomas.resumen);
router.get('/diplomas/solicitudes', verDiplomas, diplomas.solicitudes);
router.get('/diplomas/por-avisar', verDiplomas, diplomas.porAvisar);
// Solo consulta: Moodle los da por terminados y aun no han pedido el diploma.
router.get('/diplomas/terminados', verDiplomas, diplomas.terminados);
router.get('/diplomas', verDiplomas, diplomas.diplomas);

// EMITIR Diplomas sin ser admin. Diego, 22/10/2026: «que Dayana pueda emitir, no la
// dejan; puede hacerlo». Admin y superadmin por su rol, y ademas quien tenga
// `diplomas.emit` (Configuracion › Roles, por rol o por persona, como `diplomas.view`).
// Es el recorrido de emitir, entero: revisar los datos (nombre, DNI, correo, formacion y
// programa), aprobar y emitir, reintentar la emision, enviar el diploma al alumno y «Nuevo diploma» (con su catalogo).
// Siempre en sus campus: cada controlador lo mira con certifex.alcance.js, igual que para
// un admin. Rechazar, el aviso de rechazo, revocar, corregir lo emitido, la firma, el A3
// y todo `/emisiones/*` siguen siendo solo de administracion (abajo).
const emitirDiplomas = rolOPermiso(['admin', 'superadmin'], 'diplomas', 'emit');
// Revisar antes de aprobar: nombre (en Certifex), DNI, correo del CRM, formacion y programa.
router.post('/diplomas/editar', emitirDiplomas, diplomas.editar);
router.post('/diplomas/aprobar-emitir', emitirDiplomas, diplomas.aprobarEmitir);
router.post('/diplomas/emitir', emitirDiplomas, diplomas.emitir);
// «Enviar diploma al alumno»: el correo con el diploma, despues de ver el PDF.
router.post('/diplomas/avisos', emitirDiplomas, diplomas.avisos);
// «Nuevo diploma»: desde cero, eligiendo cliente y formación (19/10).
router.post('/diplomas/nuevo', emitirDiplomas, diplomas.nuevo);
router.get('/diplomas/formaciones', emitirDiplomas, diplomas.formaciones);

// Lo demas, como siempre. Los mismos roles que ven la campana de administracion: son
// quienes reciben el aviso.
router.use(roleGuard('admin', 'superadmin', 'soporte'));

router.get('/consultas', ctrl.listar);
router.patch('/consultas/:id', ctrl.actualizar);

// Emisiones: aprobar, rechazar y emitir titulos en Certifex. Solo administracion: es
// decidir quien recibe un titulo que no se puede borrar. Soporte ve las consultas, no esto.
router.get('/emisiones', soloAdmin, emisiones.listar);
router.post('/emisiones/decisiones', soloAdmin, emisiones.decidir);
router.post('/emisiones/emitir', soloAdmin, emisiones.emitir);

// Diplomas (#272): las solicitudes desde Moodle y los diplomas emitidos. Rechazar, el
// aviso de rechazo, revocar, corregir lo emitido, la firma y sincronizar el temario del
// catalogo: solo administracion, aunque se tenga `diplomas.view` o `diplomas.emit`
// (emitir y lo que lleva a emitir van arriba). Y ademas, cada admin solo sobre los
// campus de sus proyectos (certifex.alcance.js): eso lo mira cada controlador, porque
// depende de la matricula o del diploma.
router.post('/diplomas/rechazar', soloAdmin, diplomas.rechazar);
router.post('/diplomas/avisos-rechazo', soloAdmin, diplomas.avisosRechazo);
router.post('/diplomas/revocar', soloAdmin, diplomas.revocar);
router.post('/diplomas/corregir', soloAdmin, diplomas.corregir);
// La firma del alumno (CRM #349): subirla o cambiarla antes de aprobar, y verla.
router.post('/diplomas/firma', soloAdmin, uploadImage, diplomas.subirFirma);
router.get('/diplomas/firma/:matriculaId', soloAdmin, diplomas.verFirma);
// Escribe en el catalogo de productos (el temario de la formacion): de administracion.
router.post('/diplomas/formaciones/sincronizar', soloAdmin, diplomas.sincronizarFormacion);

export default router;
