import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './integrations.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/',                puede('integrations.view'), ctrl.list);
router.get('/:provider',       puede('integrations.view'), ctrl.getOne);
router.put('/',                puede('integrations.edit'), ctrl.upsert);
router.post('/:provider/test', puede('integrations.edit'), ctrl.test);
router.delete('/:provider',    puede('integrations.edit'), ctrl.remove);

export default router;
