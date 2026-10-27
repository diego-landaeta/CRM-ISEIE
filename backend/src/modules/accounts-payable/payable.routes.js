import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './payable.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/', puede('accounts_payable.view'), ctrl.list);
router.get('/stats', puede('accounts_payable.view'), ctrl.stats);
router.get('/:id', puede('accounts_payable.view'), ctrl.getOne);
router.post('/', puede('accounts_payable.create'), ctrl.create);
router.patch('/:id', puede('accounts_payable.edit'), ctrl.update);
router.delete('/:id', puede('accounts_payable.delete'), ctrl.remove);
router.post('/:id/payments', puede('accounts_payable.edit'), ctrl.addPayment);

export default router;
