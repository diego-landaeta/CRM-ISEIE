import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './change-request.controller.js';
import { uploadRfc } from './change-request.controller.js';

const router = Router();
router.use(verifyToken);

// Listado y creación: cualquier usuario autenticado puede crear su RFC y ver
// los suyos. PM/admin/superadmin ven todos (filtrado en service).
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getById);
router.patch('/:id', ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin', 'project_manager'), ctrl.remove);
router.post('/:id/reopen', roleGuard('admin', 'superadmin', 'project_manager'), ctrl.reopen);

// Aprobaciones (firma CCB)
router.post('/:id/approve', ctrl.approve);
router.get('/approvals/:approvalId/signature', ctrl.getApprovalSignature);

// Adjuntos (fotos, PDFs)
router.post('/:id/attachments', uploadRfc, ctrl.uploadAttachment);
router.get('/attachments/:attachmentId/download', ctrl.downloadAttachment);
router.delete('/attachments/:attachmentId', ctrl.deleteAttachment);

export default router;
