import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import * as ctrl from './documents.controller.js';

const router = Router();

router.use(verifyToken);

// Rate limit para /generate y /regenerate — puppeteer es heavy (~3-5s + RAM).
// Limita a 20 generaciones por usuario en 5 min para evitar abuso/DoS.
const heavyGenLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ? `doc-gen-user-${req.user.userId}` : `doc-gen-ip-${ipKeyGenerator(req.ip)}`,
  message: { success: false, error: 'Demasiadas generaciones de PDF. Intenta de nuevo en unos minutos.', code: 'RATE_LIMIT' },
});

// Lecturas con projectAccess — gestor solo ve docs de proyectos asignados.
router.get('/',                 puede('documents.view'), projectAccess, ctrl.list);
router.get('/:id/download',     puede('documents.view'), projectAccess, ctrl.download);

// Audit log de un documento — solo superadmin (expone IPs/user agents).
router.get('/:id/audit',        puede('documents.auditar'), projectAccess, ctrl.audit);

// Operaciones de creacion/modificacion — solo superadmin/admin + projectAccess.
// Preview no usa projectAccess porque no toca DB (solo renderiza HTML); su rol
// guard ya garantiza que solo admins puedan generar previews.
router.get('/next-number',      puede('documents.numeracion'), projectAccess, ctrl.peekNumber);
router.post('/set-number',      puede('documents.numeracion'), projectAccess, ctrl.setNumber);
router.post('/preview',         puede('documents.create'), ctrl.preview);
router.post('/generate',        puede('documents.create'), projectAccess, heavyGenLimit, ctrl.generate);
router.post('/:id/regenerate',  puede('documents.create'), projectAccess, heavyGenLimit, ctrl.regenerate);
router.post('/:id/resend-email', puede('documents.create'), projectAccess, ctrl.resendEmail);
router.delete('/:id',           puede('documents.delete'), projectAccess, ctrl.remove);

export default router;
