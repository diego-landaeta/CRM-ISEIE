import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './conversion.controller.js';
import * as refundsCtrl from './refunds.controller.js';

const router = Router();

router.use(verifyToken);

// Listado y detalle
router.get('/', ctrl.list);
router.get('/productos', ctrl.listProductos);
router.get('/by-lead/:leadId', ctrl.listByLead);
router.get('/:id', ctrl.getById);

// Creacion
router.post('/', ctrl.create);

// Edicion
router.patch('/:id', ctrl.update);

// Pagos parciales
router.post('/:id/payments', ctrl.addPayment);
// El gestor puede borrar pagos de leads asignados a él. Admin/superadmin siempre.
// Ownership se valida dentro del controller.
router.delete('/payments/:paymentId', ctrl.removePayment);

// Cuotas (CRM-183)
router.get('/:id/installments', ctrl.listInstallments);
router.post('/:id/installments/generate', ctrl.generateInstallments);
router.patch('/installments/:instId', ctrl.updateInstallment);
router.post('/installments/:instId/pay', ctrl.payInstallment);
// CRUD del pago ya hecho: editar (fecha/importe) o deshacer
router.patch('/installments/:instId/paid', ctrl.editPaidInstallment);
router.post('/installments/:instId/unpay', ctrl.unpayInstallment);
router.delete('/installments/:instId', ctrl.deleteInstallment);

// Devoluciones / refunds (fase de prueba)
router.get('/:id/refunds', refundsCtrl.list);
router.post('/:id/refunds', roleGuard('admin', 'superadmin'), refundsCtrl.create);
router.delete('/refunds/:refundId', roleGuard('admin', 'superadmin'), refundsCtrl.remove);

// Eliminar conversión. Gestor solo si es dueña del lead. Requiere motivo.
// Ownership + log a lead_interactions se hace dentro del controller.
router.delete('/:id', ctrl.remove);

export default router;
