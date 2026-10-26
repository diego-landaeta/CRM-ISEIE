import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './conversion.controller.js';
import * as refundsCtrl from './refunds.controller.js';
import * as repartoCtrl from './reparto.controller.js';

const router = Router();

router.use(verifyToken);

// Listado y detalle
router.get('/', puede('conversions.view'), ctrl.list);
router.get('/productos', puede('conversions.view'), ctrl.listProductos);
// Antes de /:id, o Express intentaria leer «cuotas» como un identificador.
router.get('/cuotas', puede('conversions.view'), ctrl.cuotas);
router.get('/filas', puede('conversions.view'), ctrl.filas);
router.get('/by-lead/:leadId', puede('conversions.view'), ctrl.listByLead);
router.get('/:id', puede('conversions.view'), ctrl.getById);

// Creacion
router.post('/', puede('conversions.create'), ctrl.create);

// Edicion
router.patch('/:id', puede('conversions.edit'), ctrl.update);

// Pagos parciales
router.post('/:id/payments', puede('conversions.cobros'), ctrl.addPayment);
// El gestor puede borrar pagos de leads asignados a él. Admin/superadmin siempre.
// Ownership se valida dentro del controller.
router.delete('/payments/:paymentId', puede('conversions.cobros'), ctrl.removePayment);

// Cuotas (CRM-183)
router.get('/:id/installments', puede('conversions.view'), ctrl.listInstallments);
router.post('/:id/installments/generate', puede('conversions.cobros'), ctrl.generateInstallments);
router.patch('/installments/:instId', puede('conversions.cobros'), ctrl.updateInstallment);
router.post('/installments/:instId/pay', puede('conversions.cobros'), ctrl.payInstallment);
// CRUD del pago ya hecho: editar (fecha/importe) o deshacer
router.patch('/installments/:instId/paid', puede('conversions.cobros'), ctrl.editPaidInstallment);
router.post('/installments/:instId/unpay', puede('conversions.cobros'), ctrl.unpayInstallment);
router.delete('/installments/:instId', puede('conversions.cobros'), ctrl.deleteInstallment);

// Devoluciones / refunds (fase de prueba)
// Reparto de la venta entre gestoras.
//
// Verlo: cualquiera que entre al CRM — la gestora tiene derecho a saber cómo se
// repartió su venta. Cambiarlo: SOLO admin y superadmin, y con `soloRoles` en
// vez de `roleGuard` a propósito: `roleGuard` deja pasar a `soporte` por un
// atajo interno, y esto mueve el mérito de una persona a otra.
router.get('/:id/reparto', puede('conversions.view'), repartoCtrl.get);
router.put('/:id/reparto', puede('conversions.reparto'), repartoCtrl.set);
router.delete('/:id/reparto', puede('conversions.reparto'), repartoCtrl.remove);

// Devoluciones / refunds (fase de prueba)
router.get('/:id/refunds', puede('conversions.view'), refundsCtrl.list);
router.post('/:id/refunds', puede('conversions.devoluciones'), refundsCtrl.create);
router.delete('/refunds/:refundId', puede('conversions.devoluciones'), refundsCtrl.remove);

// Eliminar conversión. Gestor solo si es dueña del lead. Requiere motivo.
// Ownership + log a lead_interactions se hace dentro del controller.
router.delete('/:id', puede('conversions.delete'), ctrl.remove);

export default router;
