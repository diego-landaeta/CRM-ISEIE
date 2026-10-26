import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './connectors.controller.js';

const router = Router();
router.use(verifyToken);
// `soloRoles` y no `roleGuard`: roleGuard deja pasar tambien a soporte, y
// Conectores es solo de admin y super admin (Diego, 29/09).

router.get('/', puede('connectors.view'), ctrl.list);
// «Servidor MCP»: tu URL para Claude en ese conector (una nueva revoca la anterior).
router.post('/:id/mcp-url', puede('connectors.edit'), ctrl.mcpUrl);
router.get('/:id', puede('connectors.view'), ctrl.getById);
router.post('/', puede('connectors.create'), ctrl.create);
router.patch('/:id', puede('connectors.edit'), ctrl.update);
router.delete('/:id', puede('connectors.delete'), ctrl.remove);

router.post('/:id/preview', puede('connectors.edit'), ctrl.preview);
router.post('/:id/import', puede('connectors.edit'), ctrl.runImport);

export default router;
