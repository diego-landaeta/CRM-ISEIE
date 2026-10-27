import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './permissions.controller.js';
import * as pantalla from './permisos.pantalla.controller.js';

const router = Router();

router.use(verifyToken);

// El catálogo de permisos (#423): secciones, nombres, descripciones,
// dependencias y valores de cada rol. Lo pinta Configuración › Roles y la
// ficha de cada persona. No es secreto: cualquiera con sesión.
router.get('/catalogo', ctrl.getCatalogo);

// Defaults del sistema — cualquier usuario autenticado puede ver (lo lee
// «Mis preferencias» para el catálogo de menú y bloques).
router.get('/system-defaults', ctrl.getSystemDefaults);

// ── Configuración › Roles (#423) ──
// Lo que trae cada rol, lo ve quien tiene «Ver roles»; cambiarlo vale para
// todas las empresas y es de «Cambiar roles» (de serie, admin y superadmin: Diego, 26/10).
router.get('/roles', puede('roles.view'), pantalla.roles);
router.put('/roles/fijos/:rol', puede('roles.edit'), pantalla.guardarRolFijo);
router.post('/roles/a-medida', puede('roles.edit'), pantalla.crearRolAMedida);
router.patch('/roles/a-medida/:id', puede('roles.edit'), pantalla.guardarRolAMedida);
router.get('/registro', puede('roles.edit'), pantalla.registro);

// ── La ficha de cada persona (#423) ──
// Lo suyo lo ve cada uno; lo de otro, quien vea usuarios (el controlador lo
// mira). Cambiarlo: «Permisos de cada persona», y el servicio acota a sus
// campus, a quien no es admin y a lo que él mismo tiene.
router.get('/personas/:id', pantalla.ficha);
router.put('/personas/:id/excepciones', puede('users.excepciones'), pantalla.guardarExcepciones);
router.put('/personas/:id/rol-a-medida', puede('users.excepciones'), pantalla.cambiarRolAMedida);

// Roles a medida, como antes (los usa la pantalla vieja y el MCP).
router.get('/custom-roles', puede('roles.view'), ctrl.listCustomRoles);
router.get('/custom-roles/:id', puede('roles.view'), ctrl.getCustomRole);
router.post('/custom-roles', puede('roles.edit'), ctrl.createCustomRole);
router.put('/custom-roles/:id', puede('roles.edit'), ctrl.updateCustomRole);
router.delete('/custom-roles/:id', puede('roles.edit'), ctrl.deleteCustomRole);

// Excepciones de una persona, todas de golpe (lo de antes): mismas reglas que
// la ficha.
router.get('/users/:userId/permissions', puede('users.excepciones'), ctrl.getUserPermissions);
router.put('/users/:userId/permissions', puede('users.excepciones'), ctrl.saveUserPermissions);

// Permisos de Tareas por rol (#210) y una clave suelta por rol y por persona
// (#384, «Diplomas · Ver»): siguen funcionando, ahora sobre lo mismo que la
// pantalla de Roles.
router.get('/role-permissions/:roleKey', puede('roles.view'), ctrl.getRolePermissions);
router.put('/role-permissions/:roleKey', puede('roles.edit'), ctrl.saveRolePermissions);
router.get('/claves/:clave/rol/:roleKey', puede('roles.view'), ctrl.getClaveDeRol);
router.put('/claves/:clave/rol/:roleKey', puede('roles.edit'), ctrl.setClaveDeRol);
router.get('/claves/:clave/personas', puede('users.excepciones'), ctrl.personasDeLaClave);
router.put('/claves/:clave/personas/:userId', puede('users.excepciones'), ctrl.setClaveDePersona);

// Vistas por rol (sidebar/dashboard/landing)
router.get('/role-views/:roleKey', ctrl.getRoleView);
router.put('/role-views/:roleKey', puede('roles.edit'), ctrl.setRoleView);

export default router;
