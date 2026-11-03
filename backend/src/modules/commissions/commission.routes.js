import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './commission.controller.js';
import { comisionPorId, ventaPorId } from '../conversions/conversion.acceso.js';

// Pagar o recalcular es escribir sobre la venta de alguien: solo de sus campus (como en ventas).
const deSuCampus = (guardia, param) => {
  const fn = (req, res, next) => guardia(req, res, next, req.params[param]);
  // Con nombre: el inventario de permisos (#423) lo reconoce como guarda de alcance (ver TECNICOS).
  Object.defineProperty(fn, 'name', { value: 'deSuCampus' });
  return fn;
};

const router = Router();
router.use(verifyToken);

// Reglas (solo superadmin)
router.get('/rules', puede('commissions.view'), ctrl.listRules);
router.post('/rules', puede('commissions.reglas'), ctrl.createRule);
router.patch('/rules/:id', puede('commissions.reglas'), ctrl.updateRule);
router.delete('/rules/:id', puede('commissions.reglas'), ctrl.deleteRule);

// Vista del propio gestor
router.get('/me', ctrl.listMine);
router.get('/me/stats', ctrl.statsMine);

// Vista admin/superadmin
router.get('/', puede('commissions.view'), ctrl.listAll);
router.get('/stats', puede('commissions.view'), ctrl.statsAll);

// Pagar comision (admin/superadmin)
router.patch('/:id/pay',              puede('commissions.pagar'), deSuCampus(comisionPorId, 'id'), ctrl.pay);

// Recalcular comision desde conversion (admin/superadmin)
router.post('/recalculate/:conversionId', puede('commissions.edit'), deSuCampus(ventaPorId, 'conversionId'), ctrl.recalculate);

export default router;
