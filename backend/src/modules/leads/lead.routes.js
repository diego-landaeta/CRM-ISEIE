import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as leadController from './lead.controller.js';
import * as leadEmailsController from './lead-emails.controller.js';
import * as spamReportController from './spam-report.controller.js';

const router = Router();

// ============================================================
// WEBHOOK (publico, autenticado por X-API-Key header)
// ============================================================
router.post('/webhooks/:slug', leadController.webhook);

// ============================================================
// RUTAS PROTEGIDAS
// ============================================================
router.use(verifyToken);

// Listado y detalle
router.get('/', puede('leads.view'), leadController.list);
router.get('/export/wasapi', puede('leads.exportar_wasapi'), leadController.exportWasapi);
router.get('/stats', puede('leads.view'), leadController.stats);
router.get('/today', puede('leads.view'), leadController.today);
router.get('/dashboard-summary', puede('leads.view'), leadController.dashboardSummary);
// Lookup público para gestores: devuelve metadata mínima de leads con el
// email indicado, ignorando el RBAC de listado normal. Para que un gestor
// pueda detectar duplicados de leads que pertenecen a otra asesora.
router.get('/lookup-by-email', puede('leads.view'), leadController.lookupByEmail);

// Check duplicado antes de crear (manual).
router.post('/check-duplicate', puede('leads.view'), leadController.checkDuplicate);

// Spam reports: rutas estáticas ANTES de /:id para que no las absorba
router.get('/spam-reports', puede('leads.spam'), spamReportController.listPending);
router.get('/spam-reports/count', puede('leads.spam'), spamReportController.countPending);
router.patch('/spam-reports/:reportId', puede('leads.spam_resolver'), spamReportController.resolveReport);

// #13 Cola de revisión de duplicados — admin/superadmin
router.get('/review-queue',              puede('leads.duplicados'), leadController.listReviewQueue);
// #102 - Repaso de duplicados sobre lo que YA hay guardado. Va antes de
// '/:id' o Express se lo come como si 'duplicados' fuera un identificador.
router.get('/duplicados',                puede('leads.duplicados'), leadController.listDuplicateGroups);
router.post('/review-queue/:id/decide',  puede('leads.duplicados'), leadController.decideReviewQueue);

// #18 Multi-cursos por lead
router.get('/:id/products',              puede('leads.view'), leadController.listLeadProducts);
router.post('/:id/products',             puede('leads.edit'), leadController.addLeadProduct);
router.patch('/:id/products/:lpId',      puede('leads.edit'), leadController.updateLeadProduct);
router.delete('/:id/products/:lpId',     puede('leads.edit'), leadController.removeLeadProduct);

router.get('/:id', puede('leads.view'), leadController.getById);
router.post('/:id/merge', puede('leads.edit'), leadController.mergeLeads);

// Creacion manual (formulario interno)
router.post('/', puede('leads.create'), leadController.createManual);

// Import CSV (bulk)
router.post('/bulk', puede('leads.create'), leadController.bulkCreate);

// Edicion general del lead
router.patch('/:id', puede('leads.edit'), leadController.update);

// Operaciones sobre lead
router.patch('/:id/status', puede('leads.edit'), leadController.changeStatus);
router.post('/:id/interactions', puede('leads.edit'), leadController.addInteraction);
router.patch('/:id/interactions/:interactionId', puede('leads.edit'), leadController.updateInteraction);
router.delete('/:id/interactions/:interactionId', puede('leads.edit'), leadController.deleteInteraction);
router.post('/:id/reminders', puede('leads.edit'), leadController.addReminder);
router.patch('/reminders/:reminderId/complete', puede('leads.edit'), leadController.completeReminder);

// Secuencias de email del lead (para popup de detalle)
router.get('/:id/sequences', puede('leads.view'), leadController.getLeadSequences);

// Historial de compra del email del lead (cross-sell / propuesto)
router.get('/:id/purchase-history', puede('leads.view'), leadController.getPurchaseHistory);

// Envío manual de email + historial (CRM-231)
router.post('/:id/send-email', puede('leads.enviar_correo'), leadEmailsController.sendLeadEmail);
router.get('/:id/emails', puede('leads.view'), leadEmailsController.listLeadEmails);

// Levantar un reporte de spam sobre un lead (cualquier autenticado).
// #15: solo admin/superadmin puede reportar spam.
router.post('/:id/report-spam', puede('leads.reportar_spam'), spamReportController.reportSpam);

// Reasignar (solo admin/superadmin)
router.patch('/:id/reassign', puede('leads.assign'), leadController.reassign);

// Borrar: «Borrar prospectos» (#204, #423). Lo que puede borrar cada uno lo
// acota el controlador: por cualquier motivo, «Borrar cualquier prospecto».
router.delete('/:id', puede('leads.delete'), leadController.softDelete);
router.patch('/:id/restore', puede('leads.restaurar'), leadController.restore);

// Asignar pendientes: re-aplica round-robin a leads con responsable_id IS NULL.
// Útil cuando llegan leads sin gestores activos y luego se activan.
router.post('/reassign-pending', puede('leads.assign'), leadController.reassignPending);

export default router;
