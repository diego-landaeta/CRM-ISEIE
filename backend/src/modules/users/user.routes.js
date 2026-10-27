import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as userController from './user.controller.js';
import * as viewsController from './user.views.controller.js';
import * as availabilityController from './availability.controller.js';

const router = Router();

// GET avatar es publico (sin auth, para que se cargue en <img>)
router.get('/:id/avatar', userController.getAvatar);

router.use(verifyToken);

// POST/DELETE avatar: usuario puede modificar el suyo, superadmin cualquiera (logica en controller)
router.post('/:id/avatar', uploadImage, userController.uploadAvatar);
router.delete('/:id/avatar', userController.deleteAvatar);

// Vistas personales (CRM-301): usuario o superadmin
router.get('/:id/views', viewsController.getViews);
router.patch('/:id/views', viewsController.setViews);

// Los avisos por correo de UNO MISMO. Sin roleGuard a proposito: cada persona
// gestiona los suyos, y el usuario sale del testigo de sesion — nadie puede
// tocar los de otro aunque acierte el identificador. Tarea #28.
router.get('/mis-avisos', userController.misAvisos);
router.patch('/mis-avisos', userController.cambiarMiAviso);

// Resto admin/superadmin

router.get('/', puede('users.view'), userController.list);
router.get('/activity-log', puede('users.view'), userController.activityLog);

// Disponibilidad (rutas con path fijo antes de las que tienen :id)
router.get('/availability', puede('users.view'), availabilityController.listAvailability);
router.delete('/availability-blocks/:blockId', puede('users.edit'), availabilityController.deleteBlock);

router.get('/:id', puede('users.view'), userController.getById);
router.post('/', puede('users.create'), userController.create);
router.patch('/:id', puede('users.edit'), userController.update);
router.delete('/:id', puede('users.delete'), userController.deactivate);
router.patch('/:id/reactivate', puede('users.edit'), userController.reactivate);
router.patch('/:id/password', puede('users.contrasena'), userController.setPassword);
// Antes de cambiar un correo, el aviso de Make (#248).
router.get('/:id/aviso-correo', puede('users.aviso_correo'), userController.avisoCorreo);
router.patch('/:id/availability', puede('users.edit'), availabilityController.setAvailability);
router.get('/:id/availability-blocks', puede('users.view'), availabilityController.listBlocks);
router.post('/:id/availability-blocks', puede('users.edit'), availabilityController.createBlock);

export default router;
