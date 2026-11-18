import router from './facturacion-auditoria.routes.js';

// Auditoría de facturación cada 2 horas y pausa de la emisión (#765).
// La tarea está en jobs/facturacionAuditoriaJob.js. Apagada de serie:
// FACTURACION_AUDITORIA_ACTIVA.
export default {
  prefix: '/api/facturacion-auditoria',
  router,
};
