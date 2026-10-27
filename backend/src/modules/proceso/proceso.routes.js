import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { ambitoDelProceso } from './proceso.ambito.js';
import * as ctrl from './proceso.controller.js';

const router = Router();
router.use(verifyToken);

// LEER los pasos lo puede hacer cualquiera con acceso al proyecto: la gestora
// necesita saber en que paso va cada prospecto, que es de lo que va todo esto.
router.get('/pasos', puede('proceso.view'), ambitoDelProceso, ctrl.listarPasos);

// CAMBIARLOS, no: el proceso es de la casa, no de cada gestora. Si cada una
// pudiera mover los dias, la cola de mañana diria una cosa distinta por persona
// y las cifras de cierre dejarian de poder compararse.
router.post('/pasos', puede('proceso.configurar_pasos'), ambitoDelProceso, ctrl.crearPaso);
// Antes que `/pasos/:id` para que «orden» no se lea como un id.
router.patch('/pasos/orden', puede('proceso.configurar_pasos'), ambitoDelProceso, ctrl.reordenarPasos);
router.patch('/pasos/:id', puede('proceso.configurar_pasos'), ambitoDelProceso, ctrl.editarPaso);
router.delete('/pasos/:id', puede('proceso.configurar_pasos'), ambitoDelProceso, ctrl.desactivarPaso);

// ── LA AGENDA DE CADA PROSPECTO (#89 · #90) ─────────────────────────────────
//
// Sin `projectAccess`: la cola puede ser de todos los proyectos a la vez, que
// es como la mira un admin. El recorte de quien puede ver que lo hace el
// controlador —una gestora solo ve lo suyo—, en el servidor y no en la
// pantalla.
router.get('/cola', puede('proceso.view'), ctrl.cola);
router.get('/cola/resumen', puede('proceso.view'), ctrl.resumenCola);
// El repaso de fin de mes: toda la base que no compro. No es la cola del dia.
router.get('/seguimiento', puede('proceso.view'), ctrl.seguimiento);
router.get('/seguimiento/resumen', puede('proceso.view'), ctrl.resumenSeguimiento);
// La base entera en formato Wasapi, para la difusion.
router.get('/seguimiento/wasapi', puede('proceso.view'), ctrl.wasapiSeguimiento);
router.get('/lead/:leadId', puede('proceso.view'), ctrl.pasosDeUnLead);
// Rellena los pasos que falten. Util despues de anadir un paso nuevo al
// proceso: los prospectos que ya estaban no lo tenian.
router.post('/lead/:leadId/replanificar', puede('proceso.replanificar'), ctrl.replanificar);
// Mover de fecha o saltarse un paso. Lo puede hacer la gestora con los suyos.
router.patch('/paso-lead/:id', puede('proceso.trabajar'), ctrl.ajustarPasoDeLead);
// Añadir un seguimiento a mano después de los pasos del proceso (5, 6…).
router.post('/lead/:leadId/seguimiento', puede('proceso.trabajar'), ctrl.anadirSeguimientoDeLead);

export default router;
