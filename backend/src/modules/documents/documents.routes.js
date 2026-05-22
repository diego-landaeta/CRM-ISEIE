import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
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
  keyGenerator: (req) => req.user?.id ? `doc-gen-user-${req.user.id}` : `doc-gen-ip-${ipKeyGenerator(req)}`,
  message: { success: false, error: 'Demasiadas generaciones de PDF. Intenta de nuevo en unos minutos.', code: 'RATE_LIMIT' },
});

// Lecturas con projectAccess — gestor solo ve docs de proyectos asignados.
router.get('/',                 projectAccess, ctrl.list);
router.get('/:id/download',     projectAccess, ctrl.download);

// Audit log de un documento — solo superadmin (expone IPs/user agents).
router.get('/:id/audit',        roleGuard('superadmin'), projectAccess, ctrl.audit);

// Operaciones de creacion/modificacion — solo superadmin/admin + projectAccess.
// Preview no usa projectAccess porque no toca DB (solo renderiza HTML); su rol
// guard ya garantiza que solo admins puedan generar previews.
router.get('/next-number',      roleGuard('superadmin', 'admin'), projectAccess, ctrl.peekNumber);
router.post('/set-number',      roleGuard('superadmin', 'admin'), projectAccess, ctrl.setNumber);
router.post('/preview',         roleGuard('superadmin', 'admin'), ctrl.preview);
router.post('/generate',        roleGuard('superadmin', 'admin'), projectAccess, heavyGenLimit, ctrl.generate);
router.post('/:id/regenerate',  roleGuard('superadmin', 'admin'), projectAccess, heavyGenLimit, ctrl.regenerate);
router.post('/:id/resend-email', roleGuard('superadmin', 'admin'), projectAccess, ctrl.resendEmail);
router.delete('/:id',           roleGuard('superadmin', 'admin'), projectAccess, ctrl.remove);

export default router;
