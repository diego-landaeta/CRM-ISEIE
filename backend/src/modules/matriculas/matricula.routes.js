import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadDoc as uploadDocMiddleware } from '../../shared/middleware/upload.js';
import * as ctrl from './matricula.controller.js';

const router = Router();

/*
  Fuera de `verifyToken`, y ahora con motivo.

  El comentario que habia aqui decia «es publico, la URL ya es no-guessable».
  La URL es `/api/matriculas/1/doc/dni`: el 1 es la matricula y la siguiente es
  la 2. No habia nada que adivinar, se contaba. Cualquiera sin cuenta en el CRM
  se bajaba los DNI escaneados de todas las matriculas.

  Sigue sin pedir sesion porque no puede: el boton es un `<a href>` y una
  etiqueta `<a>` no manda cabeceras. Lo que cambia es que ahora la credencial
  va EN la direccion --firmada y caducando a los quince minutos, como los
  enlaces pre-firmados de R2 que el CRM ya usa--. Sin firma valida, 403.

  Si algun dia se sustituye el `<a>` por una descarga por JavaScript, esta ruta
  puede pasar debajo de `verifyToken` y la firma sobra. Mientras tanto, no.
*/
router.get('/:id/doc/:tipo', ctrl.getDoc);

router.use(verifyToken);

// Los mismos que pueden crearlas. No cambia nada para quien trabaja hoy;
// cierra la puerta a cualquier rol que se añada mañana.
router.get('/', puede('matriculas.view'), ctrl.list);
router.get('/:id', puede('matriculas.view'), ctrl.getById);
router.post('/', puede('matriculas.create'), ctrl.create);
router.patch('/:id', puede('matriculas.edit'), ctrl.update);
router.delete('/:id', puede('matriculas.delete'), ctrl.remove);
router.post('/:id/estado', puede('matriculas.cambiar_estado'), ctrl.setEstado);
router.post('/:id/doc/:tipo', puede('matriculas.edit'), uploadDocMiddleware, ctrl.uploadDoc);

export default router;
