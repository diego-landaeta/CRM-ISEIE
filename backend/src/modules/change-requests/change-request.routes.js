import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './change-request.controller.js';
import { uploadRfc } from './change-request.controller.js';

const router = Router();
router.use(verifyToken);

// Listado y creación: cualquier usuario autenticado puede crear su RFC y ver
// los suyos. PM/admin/superadmin ven todos (filtrado en service).
router.get('/', puede('change_requests.view'), ctrl.list);
router.post('/', puede('change_requests.create'), ctrl.create);
router.get('/:id', puede('change_requests.view'), ctrl.getById);
router.patch('/:id', puede('change_requests.edit'), ctrl.update);
router.delete('/:id', puede('change_requests.delete'), ctrl.remove);
router.post('/:id/reopen', puede('change_requests.reopen'), ctrl.reopen);

// Aprobaciones (firma CCB)
router.post('/:id/approve', puede('change_requests.approve'), ctrl.approve);
router.get('/approvals/:approvalId/signature', puede('change_requests.view'), ctrl.getApprovalSignature);

// Adjuntos (fotos, PDFs)
router.post('/:id/attachments', puede('change_requests.edit'), uploadRfc, ctrl.uploadAttachment);
router.get('/attachments/:attachmentId/download', puede('change_requests.view'), ctrl.downloadAttachment);
router.delete('/attachments/:attachmentId', puede('change_requests.edit'), ctrl.deleteAttachment);

export default router;
