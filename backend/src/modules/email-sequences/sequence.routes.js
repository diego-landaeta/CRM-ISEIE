import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './sequence.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/', puede('email_sequences.view'), ctrl.list);
router.get('/runs', puede('email_sequences.view'), ctrl.listRuns);
router.get('/:id', puede('email_sequences.view'), ctrl.getById);
router.post('/', puede('email_sequences.create'), ctrl.create);
router.patch('/:id', puede('email_sequences.edit'), ctrl.update);
router.delete('/:id', puede('email_sequences.delete'), ctrl.remove);
router.post('/runs/start', puede('email_sequences.lanzar'), ctrl.startManual);
router.post('/runs/:runId/stop', puede('email_sequences.lanzar'), ctrl.stopRun);

export default router;
