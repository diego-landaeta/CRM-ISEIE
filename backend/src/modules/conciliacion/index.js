import router from './conciliacion.routes.js';

// Finanzas › Conciliación (CRM#905): facturas emitidas sin cobro y cobros sin
// factura, y enlazarlos. La pestaña de cargos de Stripe (CRM#906) vive en
// stripe-payments.
export default {
  prefix: '/api/conciliacion',
  router,
};
